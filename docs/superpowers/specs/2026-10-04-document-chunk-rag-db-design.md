# Document Chunk RAG — Database Layer

## Goal

Add tenant-scoped document chunk persistence for future RAG prompt injection. Schema + `DbService` wrappers only: save chunks (replace-by-filename) and fetch all chunks for a tenant. No upload pipeline, embeddings, HTTP routes, or chat wiring.

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Approach | Thin methods on existing `DbService` (no separate repository) |
| Chunk input/output shape | `{ filename: string; content: string }` |
| Save semantics | Replace by filename: delete matching filenames for tenant, then insert batch; other filenames untouched |
| Empty `chunks` on save | No-op |
| Missing tenant on save | Throw (`Tenant not found: <slug>`) |
| Missing tenant on get | Return `[]` |
| Atomicity | Prisma `$transaction` around deleteMany + createMany |
| ID types | `DocumentChunk.id` / `tenantId` use `@db.Uuid` to match `Tenant.id` |
| Migration | `prisma migrate dev --name add_document_chunks --config src/lib/postgres-prisma/prisma.config.ts` from `backend-api/` |
| Out of scope | Chunking/upload, embeddings, vector search, chat prompt injection, new API endpoints |

## Schema

```prisma
model Tenant {
  // ...existing fields...
  chunks DocumentChunk[]
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

Cascade delete: removing a tenant removes its chunks.

## Service API

**File:** `backend-api/src/lib/postgres-prisma/dbService.ts`

```ts
type DocumentChunkInput = { filename: string; content: string };

saveDocumentChunks(subdomainSlug: string, chunks: DocumentChunkInput[]): Promise<void>
getTenantContextChunks(subdomainSlug: string): Promise<DocumentChunkInput[]>
```

### `saveDocumentChunks`

1. `getTenantBySlug` / `tenant.findUnique` by `subdomainSlug`; throw if missing.
2. If `chunks.length === 0`, return.
3. `filenames = [...new Set(chunks.map(c => c.filename))]`.
4. In `$transaction`:
   - `documentChunk.deleteMany({ where: { tenantId, filename: { in: filenames } } })`
   - `documentChunk.createMany({ data: chunks.map(...) with tenantId })`

### `getTenantContextChunks`

```ts
const tenant = await prisma.tenant.findUnique({
  where: { subdomainSlug },
  select: {
    chunks: {
      select: { filename: true, content: true }
    }
  }
});
return tenant ? tenant.chunks : [];
```

## DbClient surface

Extend the injectable `DbClient` type so unit tests can fake:

- `tenant.findUnique` (including select/include of `chunks`)
- `documentChunk.deleteMany` / `createMany`
- `$transaction` that runs the callback against the fake client (or equivalent)

## Testing

Extend `backend-api/test/lib/postgres-prisma/dbService.test.ts`:

- Save resolves tenant, deletes only listed filenames, `createMany` receives all new rows.
- Save with unknown slug throws.
- Get returns `{ filename, content }[]`; unknown slug returns `[]`.

## Error handling

| Case | Behavior |
| --- | --- |
| Unknown slug (save) | Throw clear error |
| Unknown slug (get) | `[]` |
| Prisma / DB failure | Propagate; transaction rolls back partial replace |

## Non-goals

- Ordering index / chunk index fields (rely on insert order / `createdAt` only if needed later)
- Deduplicating identical content within a file
- Wiring chunks into `chatHandler` system prompts (follow-up)
