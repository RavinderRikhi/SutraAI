# Extract Sutra DB from postgres-prisma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Sutra-specific Prisma schema, migrations, and `DbService` into `services/sutra/db`, leaving `lib/postgres-prisma` as a reusable options + `createPrismaClient` utility.

**Architecture:** Extract Pool/`PrismaClient` wiring into `createPrismaClient(options) → { client, connect, disconnect }`. Relocate domain `DbService` and Prisma artifacts under Sutra. Update imports, Prisma npm scripts, and tests. No schema or API behavior changes.

**Tech Stack:** Prisma 7 (`@prisma/client`, `@prisma/adapter-pg`), `pg` Pool, TypeScript, Mocha + Chai. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-11-sutra-db-extract-design.md`
- Keep class name `DbService`; keep package folder name `postgres-prisma`.
- Factory return: `{ client, connect(), disconnect() }` with `SELECT 1` on connect.
- Factory `disconnect()`: `client.$disconnect()` only (parity with today’s `DbService`).
- No schema/model changes; move migrations as-is (do not regenerate).
- Domain methods and error messages unchanged.
- `docs/superpowers/**` is gitignored by `**superpowers**` — use `git add -f` for plan/spec commits under that path.
- Work from `backend-api/` for npm/prisma/mocha commands unless noted.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend-api/src/lib/postgres-prisma/options.ts` | Unchanged CLI/connection helpers |
| `backend-api/src/lib/postgres-prisma/client.ts` | **Create:** `createPrismaClient` + `PrismaClientHandle` |
| `backend-api/src/lib/postgres-prisma/index.ts` | Export options + factory only |
| `backend-api/src/services/sutra/db/dbService.ts` | **Move + rewire:** Sutra `DbService` / domain types |
| `backend-api/src/services/sutra/db/schema.prisma` | **Move** from lib |
| `backend-api/src/services/sutra/db/migrations/` | **Move** from lib |
| `backend-api/src/services/sutra/db/prisma.config.ts` | **Move** from lib |
| `backend-api/src/services/sutra/db/index.ts` | **Create:** re-export `DbService` + domain types |
| `backend-api/src/services/sutra/index.ts` | Split imports: options from lib, `DbService` from `./db` |
| `backend-api/package.json` | Prisma script `--config` paths |
| `backend-api/tsconfig.json` | Exclude new `prisma.config.ts` path |
| `backend-api/scripts/smoke-test.ts` | Import `DbService` from sutra db |
| `backend-api/test/lib/postgres-prisma/client.test.ts` | **Create:** factory handle-shape test |
| `backend-api/test/services/sutra/db/dbService.test.ts` | **Move** from `test/lib/postgres-prisma/` |
| Delete | `src/lib/postgres-prisma/dbService.ts` and old schema/migrations/prisma.config |

---

### Task 1: `createPrismaClient` factory

**Files:**
- Create: `backend-api/src/lib/postgres-prisma/client.ts`
- Create: `backend-api/test/lib/postgres-prisma/client.test.ts`
- Modify: `backend-api/src/lib/postgres-prisma/index.ts`

**Interfaces:**
- Consumes: `PostgresConnectionOptions` from `./options`
- Produces:
  ```ts
  export type PrismaClientHandle = {
    client: PrismaClient;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
  };
  export function createPrismaClient(
    options: PostgresConnectionOptions
  ): PrismaClientHandle;
  ```

- [ ] **Step 1: Write the failing test**

Create `backend-api/test/lib/postgres-prisma/client.test.ts`:

```ts
import { expect } from "chai";

import { createPrismaClient } from "../../../src/lib/postgres-prisma/client";
import type { PostgresConnectionOptions } from "../../../src/lib/postgres-prisma/options";

const unusedOptions: PostgresConnectionOptions = {
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "",
  database: "postgres",
  ssl: false
};

describe("createPrismaClient", () => {
  it("returns a handle with client, connect, and disconnect", async () => {
    const handle = createPrismaClient(unusedOptions);
    expect(handle.client).to.exist;
    expect(handle.connect).to.be.a("function");
    expect(handle.disconnect).to.be.a("function");
    await handle.disconnect();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend-api && NODE_ENV=test node --import tsx ./node_modules/mocha/bin/mocha "test/lib/postgres-prisma/client.test.ts"
```

Expected: FAIL (module `./client` not found or `createPrismaClient` not exported).

- [ ] **Step 3: Implement `client.ts`**

Create `backend-api/src/lib/postgres-prisma/client.ts`:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

import type { PostgresConnectionOptions } from "./options";

export type PrismaClientHandle = {
  client: PrismaClient;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
};

export function createPrismaClient(
  options: PostgresConnectionOptions
): PrismaClientHandle {
  const pool = new Pool({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    ssl: options.ssl ? { rejectUnauthorized: true } : undefined
  });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });

  return {
    client,
    async connect(): Promise<void> {
      await client.$connect();
      await pool.query("SELECT 1");
    },
    disconnect(): Promise<void> {
      return client.$disconnect();
    }
  };
}
```

Update `backend-api/src/lib/postgres-prisma/index.ts` to export the factory (keep existing `DbService` exports until Task 3):

```ts
export {
  appendPostgresOptions,
  buildPostgresUrl,
  resolvePostgresOptions,
  type PostgresConnectionOptions,
  type RawPostgresOptions
} from "./options";
export {
  createPrismaClient,
  type PrismaClientHandle
} from "./client";
export {
  DbService,
  type CreateTenantInput,
  type DocumentChunkInput,
  type Tenant
} from "./dbService";
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend-api && NODE_ENV=test node --import tsx ./node_modules/mocha/bin/mocha "test/lib/postgres-prisma/client.test.ts"
```

Expected: PASS.

If mocha hangs after the test (open `pg` Pool), force process exit is wrong — instead, after `$disconnect()`, also `await pool.end()` inside factory `disconnect`, and note that small lifecycle fix in the commit message. Prefer ending the pool over hanging CI.

- [ ] **Step 5: Commit**

```bash
git add backend-api/src/lib/postgres-prisma/client.ts \
  backend-api/src/lib/postgres-prisma/index.ts \
  backend-api/test/lib/postgres-prisma/client.test.ts
git commit -m "$(cat <<'EOF'
feat: add reusable createPrismaClient factory in postgres-prisma.

EOF
)"
```

---

### Task 2: Relocate Sutra db artifacts and rewire `DbService`

**Files:**
- Create: `backend-api/src/services/sutra/db/` (move contents into it)
- Create: `backend-api/src/services/sutra/db/index.ts`
- Modify: moved `dbService.ts` to use `createPrismaClient`
- Move: `test/lib/postgres-prisma/dbService.test.ts` → `test/services/sutra/db/dbService.test.ts`

**Interfaces:**
- Consumes: `createPrismaClient`, `PostgresConnectionOptions` from `../../../lib/postgres-prisma` (or `./options` path via lib)
- Produces: same public `DbService` API; `services/sutra/db/index.ts` re-exports

- [ ] **Step 1: Move Prisma artifacts and `dbService.ts`**

From `backend-api/`:

```bash
mkdir -p src/services/sutra/db
git mv src/lib/postgres-prisma/schema.prisma src/services/sutra/db/schema.prisma
git mv src/lib/postgres-prisma/prisma.config.ts src/services/sutra/db/prisma.config.ts
git mv src/lib/postgres-prisma/migrations src/services/sutra/db/migrations
git mv src/lib/postgres-prisma/dbService.ts src/services/sutra/db/dbService.ts
mkdir -p test/services/sutra/db
git mv test/lib/postgres-prisma/dbService.test.ts test/services/sutra/db/dbService.test.ts
```

`prisma.config.ts` stays:

```ts
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "schema.prisma",
  migrations: {
    path: "migrations"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});
```

- [ ] **Step 2: Rewire `DbService` to use the factory**

In `backend-api/src/services/sutra/db/dbService.ts`, replace the top imports and the production constructor branch.

Replace:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

import type { PostgresConnectionOptions } from "./options";
```

with:

```ts
import {
  createPrismaClient,
  type PostgresConnectionOptions
} from "../../../lib/postgres-prisma";
```

Replace the class fields and constructor/`connect`/`disconnect` so production uses the handle (keep injectable `DbClient` for tests). Full class skeleton for those parts:

```ts
export class DbService {
  private readonly client: DbClient;
  private readonly handle: ReturnType<typeof createPrismaClient> | null;

  constructor(options: PostgresConnectionOptions, client?: DbClient) {
    if (client) {
      this.client = client;
      this.handle = null;
      return;
    }
    const handle = createPrismaClient(options);
    this.handle = handle;
    this.client = handle.client as unknown as DbClient;
  }

  async connect(): Promise<void> {
    if (this.handle) {
      await this.handle.connect();
      return;
    }
    await this.client.$connect();
  }

  disconnect(): Promise<void> {
    if (this.handle) {
      return this.handle.disconnect();
    }
    return this.client.$disconnect();
  }

  // ... domain methods unchanged ...
}
```

Remove the unused `Pool` field and all inline `new Pool` / `PrismaPg` / `new PrismaClient` code from this file. Leave every domain method body exactly as it was.

- [ ] **Step 3: Add `services/sutra/db/index.ts`**

```ts
export {
  DbService,
  type CreateTenantInput,
  type DocumentChunkInput,
  type Tenant
} from "./dbService";
```

- [ ] **Step 4: Fix moved unit test imports**

In `backend-api/test/services/sutra/db/dbService.test.ts`, change the first two imports to:

```ts
import { DbService } from "../../../../src/services/sutra/db";
import type { PostgresConnectionOptions } from "../../../../src/lib/postgres-prisma/options";
```

(Depth is four `../` from `test/services/sutra/db/` to `backend-api/`.)

- [ ] **Step 5: Run DbService tests**

```bash
cd backend-api && NODE_ENV=test node --import tsx ./node_modules/mocha/bin/mocha "test/services/sutra/db/dbService.test.ts"
```

Expected: PASS (all existing cases).

- [ ] **Step 6: Commit**

```bash
git add backend-api/src/services/sutra/db \
  backend-api/src/lib/postgres-prisma \
  backend-api/test/services/sutra/db \
  backend-api/test/lib/postgres-prisma
git commit -m "$(cat <<'EOF'
refactor: move Sutra DbService and Prisma schema under services/sutra/db.

EOF
)"
```

---

### Task 3: Call sites, config, and lib cleanup

**Files:**
- Modify: `backend-api/src/lib/postgres-prisma/index.ts` (drop `DbService` exports)
- Modify: `backend-api/src/services/sutra/index.ts`
- Modify: `backend-api/scripts/smoke-test.ts`
- Modify: `backend-api/package.json`
- Modify: `backend-api/tsconfig.json`
- Modify: `backend-api/test/services/sutra/chat.test.ts`
- Modify: `backend-api/test/services/sutra/documentUpload.route.test.ts`

**Interfaces:**
- Consumes: Task 1 factory; Task 2 `./db` exports
- Produces: clean lib public API (options + factory only)

- [ ] **Step 1: Slim `lib/postgres-prisma/index.ts`**

Replace file contents with:

```ts
export {
  appendPostgresOptions,
  buildPostgresUrl,
  resolvePostgresOptions,
  type PostgresConnectionOptions,
  type RawPostgresOptions
} from "./options";
export {
  createPrismaClient,
  type PrismaClientHandle
} from "./client";
```

Confirm `src/lib/postgres-prisma/dbService.ts` is gone (moved in Task 2).

- [ ] **Step 2: Update Sutra service imports**

In `backend-api/src/services/sutra/index.ts`, replace:

```ts
import {
  appendPostgresOptions,
  DbService,
  resolvePostgresOptions,
  type RawPostgresOptions
} from "../../lib/postgres-prisma";
```

with:

```ts
import {
  appendPostgresOptions,
  resolvePostgresOptions,
  type RawPostgresOptions
} from "../../lib/postgres-prisma";
import { DbService } from "./db";
```

- [ ] **Step 3: Update smoke script**

In `backend-api/scripts/smoke-test.ts`, replace:

```ts
import {
  DbService,
  resolvePostgresOptions
} from "../src/lib/postgres-prisma";
```

with:

```ts
import { resolvePostgresOptions } from "../src/lib/postgres-prisma";
import { DbService } from "../src/services/sutra/db";
```

Leave `smokeHelpers.ts` importing `RawPostgresOptions` from lib (still valid).

- [ ] **Step 4: Update package.json Prisma scripts**

In `backend-api/package.json`:

```json
"prisma:generate": "prisma generate --config src/services/sutra/db/prisma.config.ts",
"prisma:migrate": "prisma migrate dev --name init --config src/services/sutra/db/prisma.config.ts",
"prisma:push": "prisma db push --config src/services/sutra/db/prisma.config.ts",
```

- [ ] **Step 5: Update tsconfig exclude**

In `backend-api/tsconfig.json`:

```json
"exclude": ["src/services/sutra/db/prisma.config.ts"]
```

- [ ] **Step 6: Update Sutra route test imports**

In `backend-api/test/services/sutra/chat.test.ts` and `backend-api/test/services/sutra/documentUpload.route.test.ts`, replace:

```ts
import type { DbService } from "../../../src/lib/postgres-prisma";
```

with:

```ts
import type { DbService } from "../../../src/services/sutra/db";
```

- [ ] **Step 7: Run focused tests**

```bash
cd backend-api && NODE_ENV=test node --import tsx ./node_modules/mocha/bin/mocha \
  "test/lib/postgres-prisma/**/*.test.ts" \
  "test/services/sutra/**/*.test.ts"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend-api/src/lib/postgres-prisma/index.ts \
  backend-api/src/services/sutra/index.ts \
  backend-api/scripts/smoke-test.ts \
  backend-api/package.json \
  backend-api/tsconfig.json \
  backend-api/test/services/sutra/chat.test.ts \
  backend-api/test/services/sutra/documentUpload.route.test.ts
git commit -m "$(cat <<'EOF'
refactor: point Sutra and Prisma tooling at services/sutra/db.

EOF
)"
```

---

### Task 4: Full verification

**Files:**
- None expected (verification only); fix only if something fails

**Interfaces:**
- Consumes: all prior tasks
- Produces: green suite + working `prisma generate`

- [ ] **Step 1: Confirm lib has no Sutra domain leftovers**

```bash
cd backend-api && rg -n "Tenant|DocumentChunk|DbService|schema\.prisma" src/lib/postgres-prisma
```

Expected: no matches for domain types/`DbService`/`schema.prisma` (options/client only). `rg` exit 1 with no matches is success.

- [ ] **Step 2: Regenerate Prisma client from new config**

```bash
cd backend-api && npm run prisma:generate
```

Expected: exit 0; client generated from `src/services/sutra/db/schema.prisma`.

- [ ] **Step 3: Run full test suite**

```bash
cd backend-api && npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit only if Step 1–3 required fixes**

If fixes were needed:

```bash
git add -A backend-api
git commit -m "$(cat <<'EOF'
fix: finish Sutra db extract verification cleanups.

EOF
)"
```

If nothing to commit, skip.

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Lib = options + `createPrismaClient` | Task 1, Task 3 |
| Factory handle shape + `SELECT 1` connect | Task 1 |
| Move schema/migrations/prisma.config to `services/sutra/db` | Task 2 |
| Keep `DbService` name; domain methods unchanged | Task 2 |
| Injectable `DbClient` for tests | Task 2 |
| Call sites / smoke / Prisma scripts / tsconfig | Task 3 |
| Move dbService tests; add factory test | Task 1, Task 2 |
| Success criteria (no domain in lib, tests pass, generate works) | Task 4 |
