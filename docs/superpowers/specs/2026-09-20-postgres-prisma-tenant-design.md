# SutraAI Postgres Prisma adapter design

Date: 2026-09-20  
Status: Drafted for review  
Scope: `projects/SutraAI/backend-api` — Prisma PostgreSQL adapter under `src/lib/postgres-prisma`, Tenant model, `DbService` facade, sutra process connect/disconnect

## Goals

- Add Prisma ORM (PostgreSQL) in `src/lib/postgres-prisma` so the rest of the backend never imports `@prisma/client`.
- Define a `Tenant` model and encapsulate all Prisma calls in `DbService` (`connect`, `disconnect`, `getTenantBySlug`, `createTenant`, `updateTenantState`).
- Wire connect on sutra process boot and disconnect on `SIGINT`/`SIGTERM`.
- Keep HTTP tests and `createSutraApp` free of a live database.

## Non-Goals

- Tenant HTTP routes or any route that reads/writes tenants.
- A `Db` interface file or Mongo implementation.
- Live Postgres in `npm test`.
- `createdAt` / `updatedAt`, unique `contactEmail`, or a `planType` enum.
- Copying the tutorial `pg` pool (`src/lib/postgres.ts`). No `pg` dependency.
- Passing parsed OpenRouter CLI opts into `createOpenRouterClient` (unchanged).

## Decisions

| Topic | Choice |
| --- | --- |
| Adapter layout | Everything Prisma-related lives in `src/lib/postgres-prisma/`. |
| Prisma version | ^7, matching the contract-extraction tutorial CLI. |
| CLI config file | `src/lib/postgres-prisma/prisma.config.ts` (not package root). Scripts pass `--config`. |
| Runtime connection | Discrete `--pg-*` / `PG*` flags; assemble a URL inside the adapter. Not a runtime `DATABASE_URL` flag. |
| Sutra usage | Boot wiring only (`initializeApp` + shutdown). No tenant routes. |
| Tests | Unit tests with a fake/injected Prisma client. No live Postgres. |
| Swap later | Rewrite this folder (or add a mongo folder and change the one sutra import). |

## Layout

```
backend-api/
  package.json                  # prisma scripts with --config
  tsconfig.json                 # exclude prisma.config.ts
  .env.example                  # PG* + DATABASE_URL (CLI)
  src/lib/postgres-prisma/
    prisma.config.ts            # Prisma CLI only; never imported by app code
    schema.prisma
    migrations/                 # created by prisma migrate
    options.ts                  # Commander flags + URL assembly
    dbService.ts                # PrismaClient + tenant methods
    index.ts                    # public API
  src/services/sutra/index.ts   # imports postgres-prisma only
  test/lib/postgres-prisma/
    options.test.ts
    dbService.test.ts
```

`index.ts` exports `appendPostgresOptions`, `resolvePostgresOptions`, `buildPostgresUrl`, `DbService`, and a plain `Tenant` type defined in this folder (not Prisma’s generated type). It does not re-export `@prisma/client` or `PrismaClient`.

**Import rule:** only `dbService.ts` may `import` from `@prisma/client`. `options.ts` and `index.ts` must not. Callers use `../../lib/postgres-prisma`.

### `prisma.config.ts` (CLI)

Prisma 7 does not auto-load this path. Scripts from `backend-api/`:

```
prisma generate --config src/lib/postgres-prisma/prisma.config.ts
prisma migrate dev --name init --config src/lib/postgres-prisma/prisma.config.ts
prisma db push --config src/lib/postgres-prisma/prisma.config.ts
```

Paths in the config are relative to that file:

- `schema: "schema.prisma"`
- `migrations.path: "migrations"`
- `datasource.url: env("DATABASE_URL")` — **CLI only** (`generate` does not need a live DB; `migrate` / `db push` do).

`tsconfig.json` `include` is `src/**/*.ts`. Exclude `src/lib/postgres-prisma/prisma.config.ts` so `tsc` does not emit it to `dist/` or typecheck `prisma/config` as app code.

## Schema (`schema.prisma`)

Generator: `prisma-client-js`. Datasource: `provider = "postgresql"` (no URL in the schema; Prisma 7).

```prisma
model Tenant {
  id             String  @id @default(uuid()) @db.Uuid
  businessName   String
  subdomainSlug  String  @unique
  contactEmail   String
  jsonState      Json    @default("{}") @db.JsonB
  isActive       Boolean @default(true)
  planType       String
}
```

## Connection options (`options.ts`)

`appendPostgresOptions(program: Command): Command` — mutate in place, return `program` (same chaining style as `appendOpenAIConfigOptions`).

| Flag | Env | Default |
| --- | --- | --- |
| `--pg-host` | `PGHOST` | `localhost` |
| `--pg-port` | `PGPORT` | `5432` |
| `--pg-user` | `PGUSER` or `USER` | `postgres` |
| `--pg-password` | `PGPASSWORD` | `""` |
| `--pg-database` | `PGDATABASE` | `postgres` |
| `--pg-ssl` | `PGSSLMODE=require` (when the flag is omitted) | off |

Validation: host, user, database must be non-empty after trim; port integer 1–65535. Empty password is allowed.

`resolvePostgresOptions` returns `{ host, port, user, password, database, ssl: boolean }`.

`buildPostgresUrl` produces `postgresql://user:password@host:port/database` with the password URL-encoded. If `ssl` is true, append `?sslmode=require`.

`.env.example` documents `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`, and `DATABASE_URL` (Prisma CLI).

## `DbService`

Constructed with resolved PG options. Optional constructor argument: injected client (tests). Production path: `new PrismaClient({ datasourceUrl: buildPostgresUrl(opts) })`.

| Method | Behavior |
| --- | --- |
| `connect()` | `this.client.$connect()` |
| `disconnect()` | `this.client.$disconnect()` |
| `getTenantBySlug(slug)` | `tenant.findUnique({ where: { subdomainSlug: slug } })`. Missing → `null`. Map the row to the plain `Tenant` type. |
| `createTenant(data)` | Required: `businessName`, `subdomainSlug`, `contactEmail`, `planType`. Optional: `jsonState`, `isActive`. Unique slug → Prisma `P2002` (unmapped). |
| `updateTenantState(slug, jsonState)` | `tenant.update({ where: { subdomainSlug: slug }, data: { jsonState } })`. Missing → Prisma `P2025` (unmapped). |

No other Prisma operations. Unique/not-found errors are not translated to HTTP in this increment.

## Sutra wiring

`initializeAppOptions`: chain `appendPostgresOptions` with existing OpenRouter options, then `parse`.

`initializeApp`: after `initializeServerContext`, `resolvePostgresOptions` from parsed opts, `new DbService`, `await connect()`, return context `{ ...serverContext, db }`. Connect failure rejects; the existing `require.main` catch logs and `process.exit(1)`.

`SutraContext` = `ServerContext & { db: DbService }`. `SutraServer` constructor accepts `ServerContext` or `SutraContext`; `db` is optional so `createSutraApp` stays DB-free. **No tenant routes.**

`createSutraApp`: unchanged — no `DbService`, no connect.

`require.main`: after `run()`, register `SIGINT`/`SIGTERM` to `await db.disconnect()` then exit. Do not disconnect inside `createSutraApp` tests.

## Dependencies and scripts

- Dependencies: `@prisma/client` ^7.
- Dev: `prisma` ^7.
- Scripts: `prisma:generate`, `prisma:migrate`, `prisma:push` with `--config` as above.

## Tests

Mocha + chai. No Postgres process.

| Test | Expectation |
| --- | --- |
| `buildPostgresUrl` | Encodes password; adds `sslmode=require` when ssl is true. |
| `resolvePostgresOptions` | Rejects empty host; rejects port `0` / non-integer. |
| `getTenantBySlug` (fake client) | Returns mapped tenant or `null`. |
| `createTenant` (fake client) | Calls `create` with required fields. |
| `updateTenantState` (fake client) | Calls `update` where `subdomainSlug` is the slug and `data.jsonState` is the payload. |
| Existing `/health`, `/sutra`, CORS, OpenRouter tests | Unchanged; still pass without Postgres. |

## Error handling

- Invalid PG options: throw before constructing `PrismaClient`.
- `connect` / `disconnect` failures: propagate (boot catch exits the process).
- `P2002` / `P2025`: propagate from `DbService`.

## Success criteria

- `cd backend-api && npm test` passes with no running Postgres.
- `grep` / code review: no `@prisma/client` import outside `src/lib/postgres-prisma/`.
- `npm run dev` with valid `PG*` connects at boot (manual; not gated on CI).
- Prisma CLI scripts point at the nested config file.

## Implementation notes

- Align flag parsing with tutorial `appendPostgresOptions` / `parsePort` / `parseCliBoolean`, but return `Command` from `appendPostgresOptions` and assemble a URL instead of a `pg` `Pool`.
- SSL: tutorial uses `{ rejectUnauthorized: true }` on the pool; Prisma gets `sslmode=require` on the URL.
- Do not add tenant routes “for completeness.”
