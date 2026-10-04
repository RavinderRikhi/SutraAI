# Document Chunk RAG DB Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist tenant-scoped document text chunks for future RAG, via a `DocumentChunk` Prisma model and two `DbService` methods (`saveDocumentChunks`, `getTenantContextChunks`).

**Architecture:** Extend the existing Prisma schema and thin `DbService` wrapper. Save replaces chunks by filename inside a `$transaction` (`deleteMany` then `createMany`). Get returns `{ filename, content }[]` for prompt injection later. Unit tests stay fake-client based; no HTTP or chat wiring.

**Tech Stack:** Prisma 7 (`prisma` / `@prisma/client` ^7.10), PostgreSQL, TypeScript, Mocha + Chai (existing `dbService.test.ts` pattern). No new dependencies.

## Global Constraints

- Chunk shape in and out: `{ filename: string; content: string }`.
- Save semantics: replace by filename only; other filenames for that tenant untouched.
- Empty `chunks` on save → no-op.
- Missing tenant on save → throw `Tenant not found: <slug>`.
- Missing tenant on get → `[]`.
- Wrap delete + insert in Prisma `$transaction`.
- `DocumentChunk.id` / `tenantId` use `@db.Uuid` to match `Tenant.id`.
- Migration from `backend-api/`: `npx prisma migrate dev --name add_document_chunks --config src/lib/postgres-prisma/prisma.config.ts` (requires `DATABASE_URL`).
- No upload/chunking pipeline, embeddings, chat prompt injection, or new API routes.
- Spec: `docs/superpowers/specs/2026-10-04-document-chunk-rag-db-design.md`
- Note: `docs/superpowers/**` is gitignored by `**superpowers**` — use `git add -f` when committing under that path.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend-api/src/lib/postgres-prisma/schema.prisma` | Add `DocumentChunk` + `Tenant.chunks` relation |
| `backend-api/src/lib/postgres-prisma/migrations/` | Prisma migration for `DocumentChunk` (created by CLI) |
| `backend-api/src/lib/postgres-prisma/dbService.ts` | Types, `DbClient` surface, `saveDocumentChunks`, `getTenantContextChunks` |
| `backend-api/src/lib/postgres-prisma/index.ts` | Re-export `DocumentChunkInput` |
| `backend-api/test/lib/postgres-prisma/dbService.test.ts` | Fake-client unit tests for the new methods |

---

### Task 1: Schema + migration

**Files:**
- Modify: `backend-api/src/lib/postgres-prisma/schema.prisma`
- Create: `backend-api/src/lib/postgres-prisma/migrations/<timestamp>_add_document_chunks/` (via Prisma CLI)
- Test: migration applies (CLI success); `prisma generate` succeeds

**Interfaces:**
- Consumes: existing `Tenant` model
- Produces: `DocumentChunk` model; `Tenant.chunks DocumentChunk[]`

- [ ] **Step 1: Update schema.prisma**

Replace the `Tenant` model and append `DocumentChunk` so the file looks like:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model Tenant {
  id             String          @id @default(uuid()) @db.Uuid
  businessName   String
  subdomainSlug  String          @unique
  contactEmail   String
  jsonState      Json            @default("{}") @db.JsonB
  isActive       Boolean         @default(true)
  planType       String
  chunks         DocumentChunk[]
}

model DocumentChunk {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @db.Uuid
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  filename  String
  content   String   @db.Text
  createdAt DateTime @default(now())
}
```

- [ ] **Step 2: Run migration**

From `backend-api/` (with `DATABASE_URL` set, e.g. from `.env`):

```bash
npx prisma migrate dev --name add_document_chunks --config src/lib/postgres-prisma/prisma.config.ts
```

Expected: migration folder created under `src/lib/postgres-prisma/migrations/`, client generated, command exits 0.

If the DB already matches via prior `db push` and migrate complains, resolve with Prisma’s suggested baseline/`migrate diff` only as needed — do not skip creating the migration SQL for `DocumentChunk`.

- [ ] **Step 3: Commit**

```bash
git add backend-api/src/lib/postgres-prisma/schema.prisma \
  backend-api/src/lib/postgres-prisma/migrations
git commit -m "$(cat <<'EOF'
Add DocumentChunk model and Prisma migration.

EOF
)"
```

---

### Task 2: `getTenantContextChunks`

**Files:**
- Modify: `backend-api/src/lib/postgres-prisma/dbService.ts`
- Modify: `backend-api/src/lib/postgres-prisma/index.ts`
- Modify: `backend-api/test/lib/postgres-prisma/dbService.test.ts`
- Test: `backend-api/test/lib/postgres-prisma/dbService.test.ts`

**Interfaces:**
- Consumes: `tenant.findUnique({ where: { subdomainSlug }, select: { chunks: { select: { filename, content } } } })`
- Produces:
  - `export type DocumentChunkInput = { filename: string; content: string }`
  - `DbService.getTenantContextChunks(subdomainSlug: string): Promise<DocumentChunkInput[]>`

- [ ] **Step 1: Write failing tests**

Append to `backend-api/test/lib/postgres-prisma/dbService.test.ts` (keep existing tests; extend fakes with `$transaction` / `documentChunk` stubs so construction still typechecks once `DbClient` widens — stubs can be no-ops until Task 3):

```ts
  it("getTenantContextChunks returns filename/content rows", async () => {
    const chunks = [
      { filename: "a.md", content: "one" },
      { filename: "b.md", content: "two" }
    ];
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(fake),
      tenant: {
        findUnique: async () => ({ chunks }),
        create: async () => sampleTenant,
        update: async () => sampleTenant
      },
      documentChunk: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 0 })
      }
    };
    const db = new DbService(unusedOptions, fake);
    expect(await db.getTenantContextChunks("acme")).to.deep.equal(chunks);
  });

  it("getTenantContextChunks returns [] when tenant missing", async () => {
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(fake),
      tenant: {
        findUnique: async () => null,
        create: async () => sampleTenant,
        update: async () => sampleTenant
      },
      documentChunk: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 0 })
      }
    };
    const db = new DbService(unusedOptions, fake);
    expect(await db.getTenantContextChunks("missing")).to.deep.equal([]);
  });
```

Also update **existing** fakes in the file to include `$transaction` and `documentChunk` no-ops so they satisfy the widened `DbClient` after Step 3.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd backend-api && npm test -- --grep "getTenantContextChunks"
```

Expected: FAIL — `getTenantContextChunks` is not a function / missing on `DbService`.

- [ ] **Step 3: Minimal implementation**

In `dbService.ts`:

1. Add type and widen `DbClient`:

```ts
export type DocumentChunkInput = {
  filename: string;
  content: string;
};

type TenantChunksRow = {
  chunks: DocumentChunkInput[];
};

export type DbClient = {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  tenant: {
    findUnique(args: {
      where: { subdomainSlug: string };
      select?: { chunks: { select: { filename: true; content: true } } };
    }): Promise<Tenant | TenantChunksRow | null>;
    create(args: { data: CreateTenantInput }): Promise<Tenant>;
    update(args: {
      where: { subdomainSlug: string };
      data: { jsonState: unknown };
    }): Promise<Tenant>;
  };
  documentChunk: {
    deleteMany(args: {
      where: { tenantId: string; filename: { in: string[] } };
    }): Promise<{ count: number }>;
    createMany(args: {
      data: Array<{ tenantId: string; filename: string; content: string }>;
    }): Promise<{ count: number }>;
  };
};
```

2. Add method:

```ts
  async getTenantContextChunks(subdomainSlug: string): Promise<DocumentChunkInput[]> {
    const row = (await this.client.tenant.findUnique({
      where: { subdomainSlug },
      select: {
        chunks: {
          select: {
            filename: true,
            content: true
          }
        }
      }
    })) as TenantChunksRow | null;
    return row === null ? [] : row.chunks;
  }
```

3. In `index.ts`, re-export:

```ts
export {
  DbService,
  type CreateTenantInput,
  type DocumentChunkInput,
  type Tenant
} from "./dbService";
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd backend-api && npm test -- --grep "getTenantContextChunks"
```

Expected: PASS (both new tests). Then full suite:

```bash
cd backend-api && npm test
```

Expected: all existing + new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-api/src/lib/postgres-prisma/dbService.ts \
  backend-api/src/lib/postgres-prisma/index.ts \
  backend-api/test/lib/postgres-prisma/dbService.test.ts
git commit -m "$(cat <<'EOF'
Add getTenantContextChunks for tenant RAG text.

EOF
)"
```

---

### Task 3: `saveDocumentChunks`

**Files:**
- Modify: `backend-api/src/lib/postgres-prisma/dbService.ts`
- Modify: `backend-api/test/lib/postgres-prisma/dbService.test.ts`
- Test: `backend-api/test/lib/postgres-prisma/dbService.test.ts`

**Interfaces:**
- Consumes: `DocumentChunkInput`, `DbClient.$transaction`, `documentChunk.deleteMany` / `createMany`, tenant lookup by slug
- Produces: `DbService.saveDocumentChunks(subdomainSlug: string, chunks: DocumentChunkInput[]): Promise<void>`

- [ ] **Step 1: Write failing tests**

Append:

```ts
  it("saveDocumentChunks replaces chunks for filenames in the batch", async () => {
    const deleted: unknown[] = [];
    const created: unknown[] = [];
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      $transaction: async <T>(fn: (tx: typeof fake) => Promise<T>) => fn(fake),
      tenant: {
        findUnique: async () => sampleTenant,
        create: async () => sampleTenant,
        update: async () => sampleTenant
      },
      documentChunk: {
        deleteMany: async (args: unknown) => {
          deleted.push(args);
          return { count: 1 };
        },
        createMany: async (args: unknown) => {
          created.push(args);
          return { count: 2 };
        }
      }
    };
    const db = new DbService(unusedOptions, fake);
    await db.saveDocumentChunks("acme", [
      { filename: "a.md", content: "c1" },
      { filename: "a.md", content: "c2" },
      { filename: "b.md", content: "c3" }
    ]);
    expect(deleted).to.deep.equal([
      {
        where: {
          tenantId: sampleTenant.id,
          filename: { in: ["a.md", "b.md"] }
        }
      }
    ]);
    expect(created).to.deep.equal([
      {
        data: [
          { tenantId: sampleTenant.id, filename: "a.md", content: "c1" },
          { tenantId: sampleTenant.id, filename: "a.md", content: "c2" },
          { tenantId: sampleTenant.id, filename: "b.md", content: "c3" }
        ]
      }
    ]);
  });

  it("saveDocumentChunks throws when tenant missing", async () => {
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      $transaction: async <T>(fn: (tx: typeof fake) => Promise<T>) => fn(fake),
      tenant: {
        findUnique: async () => null,
        create: async () => sampleTenant,
        update: async () => sampleTenant
      },
      documentChunk: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 0 })
      }
    };
    const db = new DbService(unusedOptions, fake);
    let err: unknown;
    try {
      await db.saveDocumentChunks("missing", [{ filename: "a.md", content: "x" }]);
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(Error);
    expect((err as Error).message).to.equal("Tenant not found: missing");
  });

  it("saveDocumentChunks no-ops on empty chunks", async () => {
    let deleteCalls = 0;
    let createCalls = 0;
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      $transaction: async <T>(fn: (tx: typeof fake) => Promise<T>) => fn(fake),
      tenant: {
        findUnique: async () => sampleTenant,
        create: async () => sampleTenant,
        update: async () => sampleTenant
      },
      documentChunk: {
        deleteMany: async () => {
          deleteCalls += 1;
          return { count: 0 };
        },
        createMany: async () => {
          createCalls += 1;
          return { count: 0 };
        }
      }
    };
    const db = new DbService(unusedOptions, fake);
    await db.saveDocumentChunks("acme", []);
    expect(deleteCalls).to.equal(0);
    expect(createCalls).to.equal(0);
  });
```

Note on `filename: { in: ["a.md", "b.md"] }`: `Set` iteration order matches first-seen order for these inserts — assert that order. If the implementation builds the list differently but with the same membership, keep the assertion as first-seen unique order from the map.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd backend-api && npm test -- --grep "saveDocumentChunks"
```

Expected: FAIL — method missing.

- [ ] **Step 3: Minimal implementation**

Add to `DbService` in `dbService.ts`:

```ts
  async saveDocumentChunks(
    subdomainSlug: string,
    chunks: DocumentChunkInput[]
  ): Promise<void> {
    const tenant = await this.client.tenant.findUnique({
      where: { subdomainSlug }
    });
    if (tenant === null || !("id" in tenant)) {
      throw new Error(`Tenant not found: ${subdomainSlug}`);
    }
    if (chunks.length === 0) {
      return;
    }
    const tenantId = tenant.id;
    const filenames = [...new Set(chunks.map((c) => c.filename))];
    await this.client.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({
        where: { tenantId, filename: { in: filenames } }
      });
      await tx.documentChunk.createMany({
        data: chunks.map((c) => ({
          tenantId,
          filename: c.filename,
          content: c.content
        }))
      });
    });
  }
```

The `!("id" in tenant)` guard handles the widened `findUnique` union (`Tenant | TenantChunksRow`); a plain `Tenant` row always has `id`.

- [ ] **Step 4: Run tests to verify pass**

```bash
cd backend-api && npm test -- --grep "DbService"
```

Expected: all `DbService` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-api/src/lib/postgres-prisma/dbService.ts \
  backend-api/test/lib/postgres-prisma/dbService.test.ts
git commit -m "$(cat <<'EOF'
Add saveDocumentChunks with replace-by-filename.

EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| `DocumentChunk` model + `Tenant.chunks` | Task 1 |
| UUID types + cascade | Task 1 |
| `migrate dev --name add_document_chunks` | Task 1 |
| `saveDocumentChunks` replace-by-filename + `createMany` | Task 3 |
| `$transaction` | Task 3 |
| Empty chunks no-op | Task 3 |
| Missing tenant throw on save | Task 3 |
| `getTenantContextChunks` → `{ filename, content }[]` / `[]` | Task 2 |
| Unit tests in `dbService.test.ts` | Tasks 2–3 |
| No chat/HTTP/embeddings | Not in any task |

No placeholders left. Method names and `DocumentChunkInput` are consistent across tasks.
