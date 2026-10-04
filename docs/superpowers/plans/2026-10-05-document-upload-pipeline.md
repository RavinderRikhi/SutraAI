# Document Upload Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/documents/upload` that accepts multipart `.pdf`/`.txt` files, extracts text, chunks ~500 chars, and persists via `DbService.saveDocumentChunks`.

**Architecture:** Pure utilities in `documentUpload.ts` (multer config, extension check, extract, chunk). Route registration and the sole `saveDocumentChunks` call live in `SutraServer` (`index.ts`). Multi-file batch; any validation/extract failure rejects the whole request with no DB write.

**Tech Stack:** Express 5, TypeScript (CommonJS), multer (memory storage), pdf-parse (pin v1.1.x for classic `pdf(buffer)` API), Mocha + Chai + Supertest, existing `DbService`.

## Global Constraints

- Register the route only in `backend-api/src/services/sutra/index.ts`.
- DB / Postgres interaction only in `index.ts` — call `this.db.saveDocumentChunks(...)` there; `documentUpload.ts` must not import Prisma/`DbService`.
- New files are utilities only; import and call them from `index.ts`.
- Multi-file: `multer.array("files", 10)`, memory storage, 10MB per file.
- Tenant via multipart field `subdomainSlug` (trim; blank → 400).
- Allowed extensions: case-insensitive `.pdf` / `.txt` only; any other → 400 entire request.
- Empty/whitespace extract → 400 `No extractable text`, entire batch, no DB write.
- Chunk size: contiguous blocks of at most 500 characters; no overlap.
- Chunk shape: `{ filename: originalname, content: chunkText }`.
- Success body: `{ success: true, message: "Documents ingested successfully", files: [{ filename, chunksIngested }] }`.
- Backend + tests only; no web UI, embeddings, or chat prompt wiring.
- Spec: `docs/superpowers/specs/2026-10-05-document-upload-pipeline-design.md`
- Note: `docs/superpowers/**` is gitignored by `**superpowers**` — use `git add -f` when committing under that path.
- Run tests from `backend-api/`: `npm test`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend-api/package.json` | Add `multer`, `pdf-parse@1.1.1`, `@types/multer`, `@types/pdf-parse` |
| `backend-api/src/services/sutra/documentUpload.ts` | Multer upload middleware, extension check, extract, chunk helpers — **no DB** |
| `backend-api/src/services/sutra/index.ts` | Register `POST /api/documents/upload`; orchestrate; sole `saveDocumentChunks` call; HTTP errors |
| `backend-api/test/services/sutra/documentUpload.test.ts` | Unit tests for utilities |
| `backend-api/test/services/sutra/documentUpload.route.test.ts` | Supertest HTTP tests with fake `DbService` |

---

### Task 1: Dependencies + upload utilities (TDD)

**Files:**
- Modify: `backend-api/package.json` (via npm install)
- Create: `backend-api/src/services/sutra/documentUpload.ts`
- Test: `backend-api/test/services/sutra/documentUpload.test.ts`

**Interfaces:**
- Consumes: `multer`, `pdf-parse` (v1.1.x)
- Produces:
  - `CHUNK_SIZE = 500`
  - `uploadDocuments` — Express middleware (`multer.array("files", 10)`)
  - `isAllowedUploadExtension(filename: string): boolean`
  - `extractTextFromUpload(file: { originalname: string; buffer: Buffer }, parsePdf?: (buf: Buffer) => Promise<{ text: string }>): Promise<string>`
  - `chunkText(text: string, size?: number): string[]`
  - `buildFileChunks(file: { originalname: string; buffer: Buffer }, parsePdf?: ...): Promise<{ filename: string; chunks: Array<{ filename: string; content: string }> }>`
  - `isMulterLimitError(err: unknown): err is { code: string }` helper optional; or export limit message mapper used by route

- [ ] **Step 1: Install dependencies**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api
npm install multer pdf-parse@1.1.1
npm install -D @types/multer @types/pdf-parse
```

Expected: packages appear in `package.json` / lockfile; install exits 0.

- [ ] **Step 2: Write failing unit tests**

Create `backend-api/test/services/sutra/documentUpload.test.ts`:

```ts
import { expect } from "chai";

import {
  CHUNK_SIZE,
  buildFileChunks,
  chunkText,
  extractTextFromUpload,
  isAllowedUploadExtension
} from "../../../src/services/sutra/documentUpload";

describe("documentUpload utilities", () => {
  describe("isAllowedUploadExtension", () => {
    it("allows pdf and txt case-insensitively", () => {
      expect(isAllowedUploadExtension("a.pdf")).to.equal(true);
      expect(isAllowedUploadExtension("b.TXT")).to.equal(true);
      expect(isAllowedUploadExtension("c.Pdf")).to.equal(true);
    });

    it("rejects other extensions", () => {
      expect(isAllowedUploadExtension("a.doc")).to.equal(false);
      expect(isAllowedUploadExtension("a.pdf.exe")).to.equal(false);
      expect(isAllowedUploadExtension("noext")).to.equal(false);
    });
  });

  describe("chunkText", () => {
    it("returns one chunk for short text", () => {
      expect(chunkText("hello")).to.deep.equal(["hello"]);
    });

    it("returns one chunk for exactly CHUNK_SIZE", () => {
      const text = "a".repeat(CHUNK_SIZE);
      expect(chunkText(text)).to.deep.equal([text]);
    });

    it("splits at CHUNK_SIZE", () => {
      const text = "a".repeat(CHUNK_SIZE + 1);
      expect(chunkText(text)).to.deep.equal([
        "a".repeat(CHUNK_SIZE),
        "a"
      ]);
    });
  });

  describe("extractTextFromUpload", () => {
    it("decodes txt as utf-8", async () => {
      const text = await extractTextFromUpload({
        originalname: "notes.txt",
        buffer: Buffer.from("hello café", "utf-8")
      });
      expect(text).to.equal("hello café");
    });

    it("uses parsePdf for pdf files", async () => {
      const text = await extractTextFromUpload(
        { originalname: "doc.pdf", buffer: Buffer.from("%PDF") },
        async () => ({ text: "  from pdf  " })
      );
      expect(text).to.equal("  from pdf  ");
    });
  });

  describe("buildFileChunks", () => {
    it("maps chunks with original filename", async () => {
      const result = await buildFileChunks({
        originalname: "hours.txt",
        buffer: Buffer.from("a".repeat(CHUNK_SIZE + 2), "utf-8")
      });
      expect(result.filename).to.equal("hours.txt");
      expect(result.chunks).to.have.length(2);
      expect(result.chunks[0]).to.deep.equal({
        filename: "hours.txt",
        content: "a".repeat(CHUNK_SIZE)
      });
      expect(result.chunks[1]).to.deep.equal({
        filename: "hours.txt",
        content: "aa"
      });
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api
npm test -- --grep "documentUpload utilities"
```

Expected: FAIL — cannot find module `documentUpload` (or similar).

- [ ] **Step 4: Implement `documentUpload.ts`**

Create `backend-api/src/services/sutra/documentUpload.ts`:

```ts
import path from "node:path";

import multer from "multer";
import pdfParse from "pdf-parse";

export const CHUNK_SIZE = 500;
export const MAX_UPLOAD_FILES = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_EXT = new Set([".pdf", ".txt"]);

export type UploadFile = {
  originalname: string;
  buffer: Buffer;
};

export type PdfParseFn = (buf: Buffer) => Promise<{ text: string }>;

export const uploadDocuments = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_UPLOAD_FILES,
    fileSize: MAX_FILE_BYTES
  }
}).array("files", MAX_UPLOAD_FILES);

export function isAllowedUploadExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXT.has(ext);
}

export async function extractTextFromUpload(
  file: UploadFile,
  parsePdf: PdfParseFn = pdfParse
): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === ".txt") {
    return file.buffer.toString("utf-8");
  }
  if (ext === ".pdf") {
    const result = await parsePdf(file.buffer);
    return result.text ?? "";
  }
  throw new Error(`Unsupported extension: ${ext}`);
}

export function chunkText(text: string, size: number = CHUNK_SIZE): string[] {
  if (text.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

export async function buildFileChunks(
  file: UploadFile,
  parsePdf?: PdfParseFn
): Promise<{
  filename: string;
  chunks: Array<{ filename: string; content: string }>;
}> {
  const text = await extractTextFromUpload(file, parsePdf);
  const parts = chunkText(text);
  return {
    filename: file.originalname,
    chunks: parts.map((content) => ({
      filename: file.originalname,
      content
    }))
  };
}

export function multerLimitMessage(err: unknown): string | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    const code = (err as { code: string }).code;
    if (code === "LIMIT_FILE_SIZE") {
      return "File too large";
    }
    if (code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE") {
      return "Too many files";
    }
  }
  return null;
}
```

- [ ] **Step 5: Run unit tests to verify they pass**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api
npm test -- --grep "documentUpload utilities"
```

Expected: PASS (all utilities tests green).

- [ ] **Step 6: Commit**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI
git add backend-api/package.json backend-api/package-lock.json \
  backend-api/src/services/sutra/documentUpload.ts \
  backend-api/test/services/sutra/documentUpload.test.ts
git commit -m "$(cat <<'EOF'
feat: add document upload extract and chunk utilities

EOF
)"
```

---

### Task 2: Register upload route + HTTP tests (TDD)

**Files:**
- Modify: `backend-api/src/services/sutra/index.ts`
- Create: `backend-api/test/services/sutra/documentUpload.route.test.ts`

**Interfaces:**
- Consumes: `uploadDocuments`, `isAllowedUploadExtension`, `buildFileChunks`, `multerLimitMessage` from `./documentUpload`; `this.db.saveDocumentChunks`
- Produces: `POST /api/documents/upload` behavior per spec

- [ ] **Step 1: Write failing HTTP tests**

Create `backend-api/test/services/sutra/documentUpload.route.test.ts`:

```ts
import { expect } from "chai";
import request from "supertest";

import type { DbService } from "../../../src/lib/postgres-prisma";
import { initializeServerContext } from "../../../src/lib/base-server";
import { SutraServer } from "../../../src/services/sutra/index";
import { CHUNK_SIZE } from "../../../src/services/sutra/documentUpload";

function buildApp(deps: { db?: DbService }) {
  const context = initializeServerContext({
    serviceName: "sutra",
    host: "127.0.0.1",
    port: 3000,
    corsOrigins: []
  });
  const server = new SutraServer({
    ...context,
    db: deps.db
  });
  server.registerRoutes();
  return server.getApp();
}

describe("POST /api/documents/upload", () => {
  it("returns 503 when db is missing", async () => {
    const app = buildApp({});
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "acme")
      .attach("files", Buffer.from("hello"), "a.txt");
    expect(res.status).to.equal(503);
    expect(res.body.message).to.equal("Upload unavailable");
  });

  it("returns 400 when subdomainSlug is missing", async () => {
    const db = {
      saveDocumentChunks: async () => undefined
    } as unknown as DbService;
    const app = buildApp({ db });
    const res = await request(app)
      .post("/api/documents/upload")
      .attach("files", Buffer.from("hello"), "a.txt");
    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal("Invalid upload request");
  });

  it("returns 400 when no files are attached", async () => {
    const db = {
      saveDocumentChunks: async () => undefined
    } as unknown as DbService;
    const app = buildApp({ db });
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "acme");
    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal("Invalid upload request");
  });

  it("returns 400 when any extension is disallowed", async () => {
    const db = {
      saveDocumentChunks: async () => undefined
    } as unknown as DbService;
    const app = buildApp({ db });
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "acme")
      .attach("files", Buffer.from("hello"), "a.txt")
      .attach("files", Buffer.from("x"), "b.doc");
    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal("Only .pdf and .txt files are allowed");
  });

  it("returns 400 when extractable text is empty", async () => {
    const db = {
      saveDocumentChunks: async () => undefined
    } as unknown as DbService;
    const app = buildApp({ db });
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "acme")
      .attach("files", Buffer.from("   \n"), "blank.txt");
    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal("No extractable text");
  });

  it("returns 404 when tenant is missing", async () => {
    const db = {
      saveDocumentChunks: async () => {
        throw new Error("Tenant not found: missing");
      }
    } as unknown as DbService;
    const app = buildApp({ db });
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "missing")
      .attach("files", Buffer.from("hello"), "a.txt");
    expect(res.status).to.equal(404);
    expect(res.body.message).to.equal("Tenant not found");
  });

  it("returns 200 and saves flattened chunks for multiple files", async () => {
    let saved: { slug: string; chunks: Array<{ filename: string; content: string }> } | null =
      null;
    const db = {
      saveDocumentChunks: async (
        slug: string,
        chunks: Array<{ filename: string; content: string }>
      ) => {
        saved = { slug, chunks };
      }
    } as unknown as DbService;
    const app = buildApp({ db });
    const long = "a".repeat(CHUNK_SIZE + 1);
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "acme")
      .attach("files", Buffer.from(long), "menu.txt")
      .attach("files", Buffer.from("hours open"), "hours.txt");

    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({
      success: true,
      message: "Documents ingested successfully",
      files: [
        { filename: "menu.txt", chunksIngested: 2 },
        { filename: "hours.txt", chunksIngested: 1 }
      ]
    });
    expect(saved).to.not.equal(null);
    expect(saved!.slug).to.equal("acme");
    expect(saved!.chunks).to.have.length(3);
    expect(saved!.chunks.map((c) => c.filename)).to.deep.equal([
      "menu.txt",
      "menu.txt",
      "hours.txt"
    ]);
  });
});
```

- [ ] **Step 2: Run route tests to verify they fail**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api
npm test -- --grep "POST /api/documents/upload"
```

Expected: FAIL — 404 or cannot POST (route missing), or connection errors / wrong status.

- [ ] **Step 3: Wire route and handler in `index.ts`**

In `backend-api/src/services/sutra/index.ts`:

1. Add imports (extract then trim-check, then chunk — not `buildFileChunks` in the handler, so whitespace-only files fail correctly):

```ts
import {
  chunkText,
  extractTextFromUpload,
  isAllowedUploadExtension,
  multerLimitMessage,
  uploadDocuments
} from "./documentUpload";
```

2. Inside `registerRoutes()`, after the `/api/chat` registration, add:

```ts
    this.app.post("/api/documents/upload", (req: Request, res: Response, next) => {
      uploadDocuments(req, res, (err: unknown) => {
        if (err) {
          const limitMessage = multerLimitMessage(err);
          if (limitMessage !== null) {
            jsonError(res, 400, limitMessage, req.requestId);
            return;
          }
          next(err);
          return;
        }
        void this.handleDocumentUpload(req, res).catch(next);
      });
    });
```

3. Add private method on `SutraServer` (after `handleChatPost`):

```ts
  private async handleDocumentUpload(req: Request, res: Response): Promise<void> {
    const requestId = req.requestId;

    if (this.db === undefined) {
      jsonError(res, 503, "Upload unavailable", requestId);
      return;
    }

    const subdomainSlug =
      typeof req.body?.subdomainSlug === "string" ? req.body.subdomainSlug.trim() : "";
    const files = Array.isArray(req.files) ? req.files : [];

    if (subdomainSlug === "" || files.length === 0) {
      jsonError(res, 400, "Invalid upload request", requestId);
      return;
    }

    if (!files.every((f) => isAllowedUploadExtension(f.originalname))) {
      jsonError(res, 400, "Only .pdf and .txt files are allowed", requestId);
      return;
    }

    const fileResults: Array<{ filename: string; chunksIngested: number }> = [];
    const allChunks: Array<{ filename: string; content: string }> = [];

    for (const file of files) {
      const text = await extractTextFromUpload({
        originalname: file.originalname,
        buffer: file.buffer
      });
      if (text.trim() === "") {
        jsonError(res, 400, "No extractable text", requestId);
        return;
      }
      const chunks = chunkText(text).map((content) => ({
        filename: file.originalname,
        content
      }));
      fileResults.push({
        filename: file.originalname,
        chunksIngested: chunks.length
      });
      allChunks.push(...chunks);
    }

    try {
      await this.db.saveDocumentChunks(subdomainSlug, allChunks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Tenant not found:")) {
        jsonError(res, 404, "Tenant not found", requestId);
        return;
      }
      throw error;
    }

    this.log.info("documents_uploaded", {
      requestId: requestId ?? "unknown",
      subdomainSlug,
      fileCount: files.length,
      chunksIngested: allChunks.length
    });

    res.status(200).json({
      success: true,
      message: "Documents ingested successfully",
      files: fileResults
    });
  }
```

- [ ] **Step 4: Run route tests to verify they pass**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api
npm test -- --grep "POST /api/documents/upload"
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api
npm test
```

Expected: all existing + new tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI
git add backend-api/src/services/sutra/index.ts \
  backend-api/test/services/sutra/documentUpload.route.test.ts
git commit -m "$(cat <<'EOF'
feat: add POST /api/documents/upload ingestion endpoint

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| Multer memory storage + `files` field | Task 1 (`uploadDocuments`) + Task 2 wiring |
| Reject non-`.pdf`/`.txt` entire request | Task 2 |
| PDF via pdf-parse; TXT utf-8 | Task 1 |
| Chunk ~500; `{ filename, content }` | Task 1 |
| `saveDocumentChunks` only from `index.ts` | Task 2 |
| Multi-file success `files[]` | Task 2 |
| Empty extract → 400 | Task 2 |
| Tenant missing → 404 | Task 2 |
| Multer size/count → 400 messages | Task 1 `multerLimitMessage` + Task 2 |
| No UI / no chat wiring | Not in either task |

No TBD placeholders remain. Types/names consistent: `CHUNK_SIZE`, `uploadDocuments`, `extractTextFromUpload`, `chunkText`, `multerLimitMessage`.
