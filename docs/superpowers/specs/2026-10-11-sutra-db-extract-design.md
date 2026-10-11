# Extract Sutra DB from `postgres-prisma`

## Goal

Make `backend-api/src/lib/postgres-prisma` a reusable Postgres/Prisma utility with no Sutra domain. Move Sutra-specific schema, migrations, and `DbService` into `backend-api/src/services/sutra/db`. Behavior stays the same; this is a ownership/layout refactor only.

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Approach | Straight relocate (no extra module split under Sutra db) |
| Lib contents | Connection helpers + thin `createPrismaClient` factory |
| Factory return | `{ client, connect(), disconnect() }` (Pool + adapter wired; `SELECT 1` on connect) |
| Domain class name | Keep `DbService` |
| Schema / migrations / prisma config | Move as-is to `services/sutra/db/` |
| Disconnect behavior | Parity with today (`$disconnect` only; no new `pool.end()`) |
| Out of scope | Schema changes, new migrations, API behavior changes, renaming `postgres-prisma` |

## Target layout

### `backend-api/src/lib/postgres-prisma/` (reusable)

| File | Role |
| --- | --- |
| `options.ts` | Unchanged CLI/connection helpers |
| `client.ts` (new) | `createPrismaClient(options)` |
| `index.ts` | Export options + factory only |

Removed from this folder: `dbService.ts`, `schema.prisma`, `migrations/`, `prisma.config.ts`.

### `backend-api/src/services/sutra/db/` (Sutra-specific)

| File | Role |
| --- | --- |
| `dbService.ts` | Current `DbService` + Tenant/chunk types |
| `schema.prisma` | Moved as-is |
| `migrations/` | Moved as-is (history preserved) |
| `prisma.config.ts` | Moved; schema path still relative to this folder |
| `index.ts` | Re-export `DbService` and domain types |

## Factory API

```ts
type PrismaClientHandle = {
  client: PrismaClient;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
};

createPrismaClient(options: PostgresConnectionOptions): PrismaClientHandle;
```

- Build `Pool` from options → `PrismaPg` adapter → `PrismaClient`.
- `connect()`: `client.$connect()` then `pool.query("SELECT 1")`.
- `disconnect()`: `client.$disconnect()` (same as current `DbService.disconnect`).
- No Tenant/DocumentChunk methods on the handle.

## `DbService` wiring

- Production: constructor calls `createPrismaClient(options)`, stores the handle; `connect`/`disconnect` delegate to it; domain methods use `handle.client` (still typed/narrowed via existing `DbClient` surface as needed).
- Tests: optional injected `DbClient` remains (no real pool).
- Domain methods unchanged: `getTenantBySlug`, `createTenant`, `updateTenantState`, `getTenantContextChunks`, `saveDocumentChunks`.

## Call-site updates

- `services/sutra/index.ts`: import `appendPostgresOptions` / `resolvePostgresOptions` / types from `../../lib/postgres-prisma`; import `DbService` from `./db`.
- `package.json` Prisma scripts: `--config src/services/sutra/db/prisma.config.ts`.
- `tsconfig.json` exclude: point at the new `prisma.config.ts` path.
- Smoke scripts: options from lib; `DbService` from sutra db if used.

## Tests

| Before | After |
| --- | --- |
| `test/lib/postgres-prisma/dbService.test.ts` | `test/services/sutra/db/dbService.test.ts` |
| `test/lib/postgres-prisma/options.test.ts` | stays |
| — | Small test for `createPrismaClient` handle shape / connect wiring (no domain methods) |

Existing chat/upload tests that import `DbService` type update import path only.

## Errors

- Domain errors unchanged (e.g. `Tenant not found: <slug>`).
- Connection/CLI validation stays in `options.ts`.
- No new error types.

## Success criteria

1. `lib/postgres-prisma` contains no Tenant/DocumentChunk models, migrations, or domain service.
2. Sutra boots with the same CLI Postgres flags.
3. Existing db / chat / upload tests pass after import path updates.
4. `prisma:generate` (and migrate/push scripts) work against `services/sutra/db/prisma.config.ts`.
