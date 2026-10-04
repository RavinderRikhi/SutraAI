# Document Upload Pipeline — Ingestion Endpoint

## Goal

Add `POST /api/documents/upload` so a tenant can ingest one or more `.pdf` / `.txt` files into `DocumentChunk` rows via the existing `DbService.saveDocumentChunks` replace-by-filename API. Backend only: extract → chunk ~500 chars → persist. No web UI, embeddings, vector search, or chat prompt wiring.

Builds on [2026-10-04-document-chunk-rag-db-design.md](./2026-10-04-document-chunk-rag-db-design.md).

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Approach | Thin route handler on `SutraServer` + pure utilities module (Approach 1) |
| Route registration | Only in `backend-api/src/services/sutra/index.ts` (`SutraServer.registerRoutes`) |
| DB calls | Stay in `index.ts` only — call `this.db.saveDocumentChunks(...)` there; utilities must not import Prisma/`DbService` |
| New files | Utilities only (e.g. `documentUpload.ts`); import and invoke from `index.ts` |
| Upload mode | Multi-file: `multer.array("files", 10)` with memory storage |
| Tenant identity | Multipart form field `subdomainSlug` (required, non-blank after trim) |
| Allowed extensions | Case-insensitive `.pdf` and `.txt` only; any other extension → HTTP 400, reject entire request |
| Empty extract | Any file with empty/whitespace-only text → HTTP 400 (`No extractable text`), reject entire batch, no DB write |
| Chunk size | ~500 characters per chunk; last chunk may be shorter; no overlap |
| Chunk shape | `{ filename: file.originalname, content: chunkText }` |
| Persist | Single `saveDocumentChunks(subdomainSlug, allChunks)` after all files succeed extraction/chunking |
| Size limits | 10 files max; 10MB per file (multer limits) |
| Scope | Backend API + tests only |
| Out of scope | Web upload UI, embeddings, retrieval, chat system-prompt injection |

## Architecture

```
Client (multipart)
  → multer.memoryStorage (files field)
  → SutraServer.handleDocumentUpload (index.ts)
       → validate subdomainSlug + files present
       → validate extensions (utility)
       → per file: extractText (utility) → reject if empty
       → per file: chunkText ~500 (utility)
       → this.db.saveDocumentChunks(slug, flattenedChunks)
  → 200 JSON
```

### Files

| Path | Role |
| --- | --- |
| `backend-api/src/services/sutra/index.ts` | Register route; multer middleware wiring; orchestration; sole DB call; HTTP status mapping |
| `backend-api/src/services/sutra/documentUpload.ts` | Export multer upload middleware (or factory), `isAllowedUploadExtension`, `extractTextFromUpload`, `chunkText`, helpers to build per-file chunk lists — **no DB** |
| `backend-api/package.json` | Add `multer`, `pdf-parse`, `@types/multer` (and pdf-parse types if required) |

Reuse existing `jsonError` / requestId patterns from chat. Do not move Postgres logic out of `index.ts`.

## Request / response

**Request:** `POST /api/documents/upload` — `multipart/form-data`

- `subdomainSlug` (text) — required
- `files` — one or more files, each `.pdf` or `.txt`

**Success — HTTP 200:**

```json
{
  "success": true,
  "message": "Documents ingested successfully",
  "files": [
    { "filename": "menu.pdf", "chunksIngested": 3 },
    { "filename": "hours.txt", "chunksIngested": 1 }
  ]
}
```

Multi-file adapts the original singular `{ filename, chunksIngested }` into `files[]`.

## Text extraction & chunking

1. **`.pdf`:** `pdf-parse` on `file.buffer`; use returned `text`.
2. **`.txt`:** `file.buffer.toString("utf-8")`.
3. Trim / treat whitespace-only as empty → fail batch (see errors).
4. **Chunking:** split into contiguous blocks of at most 500 characters (simple index stepping; no sentence-aware split, no overlap). Map each block to `{ filename: originalname, content }`.
5. Flatten all files’ chunks for one save; per-file `chunksIngested` counts that file’s chunks only.

## Error handling

Fail the entire request before any DB write when validation or extraction fails.

| Case | Status | Body |
| --- | --- | --- |
| Missing/blank `subdomainSlug`, or no files | 400 | `{ message: "Invalid upload request", requestId? }` |
| Any disallowed extension | 400 | `{ message: "Only .pdf and .txt files are allowed", requestId? }` |
| Any file has no extractable text | 400 | `{ message: "No extractable text", requestId? }` |
| Multer file too large (`LIMIT_FILE_SIZE`) | 400 | `{ message: "File too large", requestId? }` |
| Multer too many files (`LIMIT_FILE_COUNT`) | 400 | `{ message: "Too many files", requestId? }` |
| `saveDocumentChunks` throws tenant missing | 404 | `{ message: "Tenant not found", requestId? }` |
| Other DB / unexpected errors | 500 | Existing Express error middleware |

Map `Error` message matching `Tenant not found:` (from `DbService`) to 404, same spirit as chat’s not-found handling.

## Testing

**Unit** — `backend-api/test/services/sutra/documentUpload.test.ts`

- Extension allow/deny (case, wrong types)
- `.txt` extraction; PDF path with stubbed `pdf-parse`
- Empty / whitespace → no extractable text signal
- Chunking: length 500 → 1 chunk; 501 → 2; short → 1

**HTTP** — supertest against `SutraServer` with fake/`stub` `db` (mirror chat tests)

- 400: missing slug, no files, bad extension, empty extract
- 404: `saveDocumentChunks` rejects with tenant-not-found
- 200: multi-file; assert one `saveDocumentChunks` call with flattened chunks and response `files[]`

No live PDF smoke required in this slice.

## Non-goals

- Frontend upload control
- Auth / API keys beyond existing CORS
- Overlapping or semantic chunking
- Ordering / `chunkIndex` columns (unchanged schema)
- Wiring chunks into `buildChatSystemPrompt`
