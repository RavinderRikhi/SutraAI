# Postgres Prisma Tenant Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Prisma PostgreSQL adapter under `src/lib/postgres-prisma` with a `Tenant` model and `DbService`, connect it on sutra process boot, and keep `@prisma/client` out of every other backend file.

**Architecture:** One folder is the Postgres adapter: CLI/URL helpers, Prisma schema, and `DbService`. Sutra imports only that folder’s public export. Runtime connection is assembled from `--pg-*` / `PG*` flags; `prisma.config.ts` is CLI-only (`--config`) and is never imported by the app. HTTP tests keep using `createSutraApp` with no database.

**Tech Stack:** TypeScript CommonJS, Prisma ^7, `@prisma/client` ^7, commander ^14, mocha/chai, tsx

**Spec:** `docs/superpowers/specs/2026-09-20-postgres-prisma-tenant-design.md`

## Global Constraints

- Package root: `projects/SutraAI/backend-api`
- `"type": "commonjs"`, `tsconfig` `rootDir: "src"`
- Only `src/lib/postgres-prisma/dbService.ts` may `import` from `@prisma/client`
- No `pg` package; no tenant HTTP routes; no `Db` interface file; no Mongo
- No live Postgres in `npm test`
- Prisma CLI config lives at `src/lib/postgres-prisma/prisma.config.ts`, not package root
- Runtime uses discrete `--pg-*` flags, not a runtime `--database-url`
- `createSutraApp` must not construct or connect `DbService`
- Do not add `createdAt` / `updatedAt`, unique `contactEmail`, or a `planType` enum
- Every task's requirements implicitly include this section

---

## File Map

- Create: `backend-api/src/lib/postgres-prisma/options.ts` — Commander flags, validation, URL assembly
- Create: `backend-api/src/lib/postgres-prisma/schema.prisma` — Tenant model
- Create: `backend-api/src/lib/postgres-prisma/prisma.config.ts` — Prisma 7 CLI config
- Create: `backend-api/src/lib/postgres-prisma/dbService.ts` — PrismaClient + tenant methods
- Create: `backend-api/src/lib/postgres-prisma/index.ts` — public barrel
- Create: `backend-api/test/lib/postgres-prisma/options.test.ts`
- Create: `backend-api/test/lib/postgres-prisma/dbService.test.ts`
- Modify: `backend-api/package.json` — prisma deps and scripts
- Modify: `backend-api/tsconfig.json` — exclude `prisma.config.ts`
- Modify: `backend-api/.env.example` — `PG*` + `DATABASE_URL`
- Modify: `backend-api/src/services/sutra/index.ts` — options chain, connect, optional `db`, shutdown

---

### Task 1: Postgres connection options and URL

**Files:**
- Create: `backend-api/src/lib/postgres-prisma/options.ts`
- Test: `backend-api/test/lib/postgres-prisma/options.test.ts`

**Interfaces:**
- Consumes: `commander` `Command`
- Produces:
  - `export type PostgresConnectionOptions = { host: string; port: number; user: string; password: string; database: string; ssl: boolean }`
  - `export type RawPostgresOptions = { pgHost?: string; pgPort?: string | number; pgUser?: string; pgPassword?: string; pgDatabase?: string; pgSsl?: boolean | string }`
  - `export function appendPostgresOptions(program: Command): Command`
  - `export function resolvePostgresOptions(raw: RawPostgresOptions): PostgresConnectionOptions`
  - `export function buildPostgresUrl(options: PostgresConnectionOptions): string`

- [ ] **Step 1: Write the failing test**

Create `backend-api/test/lib/postgres-prisma/options.test.ts`:

```ts
import { expect } from "chai";
import { Command } from "commander";

import {
  appendPostgresOptions,
  buildPostgresUrl,
  resolvePostgresOptions
} from "../../../src/lib/postgres-prisma/options";

describe("buildPostgresUrl", () => {
  it("percent-encodes the password", () => {
    const url = buildPostgresUrl({
      host: "localhost",
      port: 5432,
      user: "postgres",
      password: "p@ss/word",
      database: "sutra",
      ssl: false
    });
    expect(url).to.equal(
      "postgresql://postgres:p%40ss%2Fword@localhost:5432/sutra"
    );
  });

  it("appends sslmode=require when ssl is true", () => {
    const url = buildPostgresUrl({
      host: "db.example",
      port: 5432,
      user: "u",
      password: "",
      database: "sutra",
      ssl: true
    });
    expect(url).to.equal(
      "postgresql://u:@db.example:5432/sutra?sslmode=require"
    );
  });
});

describe("resolvePostgresOptions", () => {
  it("rejects an empty host", () => {
    expect(() =>
      resolvePostgresOptions({
        pgHost: "  ",
        pgPort: 5432,
        pgUser: "postgres",
        pgPassword: "",
        pgDatabase: "postgres"
      })
    ).to.throw(/host/);
  });

  it("rejects port 0", () => {
    expect(() =>
      resolvePostgresOptions({
        pgHost: "localhost",
        pgPort: 0,
        pgUser: "postgres",
        pgPassword: "",
        pgDatabase: "postgres"
      })
    ).to.throw(/port/);
  });

  it("rejects a non-integer port", () => {
    expect(() =>
      resolvePostgresOptions({
        pgHost: "localhost",
        pgPort: "abc",
        pgUser: "postgres",
        pgPassword: "",
        pgDatabase: "postgres"
      })
    ).to.throw(/port/);
  });
});

describe("appendPostgresOptions", () => {
  it("registers --pg-host and returns the same Command", () => {
    const program = new Command();
    const returned = appendPostgresOptions(program);
    expect(returned).to.equal(program);
    const opts = program
      .parse(["node", "sutra", "--pg-host", "db.internal"], { from: "user" })
      .opts() as { pgHost: string };
    expect(opts.pgHost).to.equal("db.internal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api && NODE_ENV=test node --import tsx ./node_modules/mocha/bin/mocha "test/lib/postgres-prisma/options.test.ts"
```

Expected: FAIL (cannot resolve `options` module).

- [ ] **Step 3: Write minimal implementation**

Create `backend-api/src/lib/postgres-prisma/options.ts`:

```ts
import { Command } from "commander";

export type PostgresConnectionOptions = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
};

export type RawPostgresOptions = {
  pgHost?: string;
  pgPort?: string | number;
  pgUser?: string;
  pgPassword?: string;
  pgDatabase?: string;
  pgSsl?: boolean | string;
};

function parsePort(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `Invalid pg port: ${value}. Expected integer between 1 and 65535.`
    );
  }
  return parsed;
}

function parseCliBoolean(value: boolean | string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`Invalid pg ssl value: ${value}. Expected true or false.`);
}

function requireNonEmpty(name: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid postgres option: ${name} must be a non-empty string.`);
  }
  return trimmed;
}

export function appendPostgresOptions(program: Command): Command {
  program
    .option("--pg-host <string>", "PostgreSQL host", process.env.PGHOST ?? "localhost")
    .option("--pg-port <number>", "PostgreSQL port", process.env.PGPORT ?? "5432")
    .option(
      "--pg-user <string>",
      "PostgreSQL user",
      process.env.PGUSER ?? process.env.USER ?? "postgres"
    )
    .option("--pg-password <string>", "PostgreSQL password", process.env.PGPASSWORD ?? "")
    .option(
      "--pg-database <string>",
      "PostgreSQL database",
      process.env.PGDATABASE ?? "postgres"
    )
    .option(
      "--pg-ssl [boolean]",
      "Enable PostgreSQL SSL (true/false)",
      parseCliBoolean,
      undefined
    );
  return program;
}

export function resolvePostgresOptions(
  rawOptions: RawPostgresOptions
): PostgresConnectionOptions {
  const host = requireNonEmpty("host", rawOptions.pgHost ?? "");
  const user = requireNonEmpty("user", rawOptions.pgUser ?? "");
  const database = requireNonEmpty("database", rawOptions.pgDatabase ?? "");
  const explicitCliSsl = parseCliBoolean(rawOptions.pgSsl);
  const ssl =
    explicitCliSsl !== undefined
      ? explicitCliSsl
      : process.env.PGSSLMODE === "require";

  return {
    host,
    port: parsePort(rawOptions.pgPort ?? ""),
    user,
    password: rawOptions.pgPassword ?? "",
    database,
    ssl
  };
}

export function buildPostgresUrl(options: PostgresConnectionOptions): string {
  const user = encodeURIComponent(options.user);
  const password = encodeURIComponent(options.password);
  const base = `postgresql://${user}:${password}@${options.host}:${options.port}/${options.database}`;
  return options.ssl ? `${base}?sslmode=require` : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the same mocha command as Step 2.

Expected: PASS (all tests in that file).

- [ ] **Step 5: Commit**

```bash
git add projects/SutraAI/backend-api/src/lib/postgres-prisma/options.ts \
  projects/SutraAI/backend-api/test/lib/postgres-prisma/options.test.ts
git commit -m "$(cat <<'EOF'
Add Postgres CLI options and connection URL helper for Sutra.

EOF
)"
```

---

### Task 2: Prisma 7 schema, CLI config, and generate

**Files:**
- Create: `backend-api/src/lib/postgres-prisma/schema.prisma`
- Create: `backend-api/src/lib/postgres-prisma/prisma.config.ts`
- Modify: `backend-api/package.json`
- Modify: `backend-api/tsconfig.json`
- Modify: `backend-api/.env.example`

**Interfaces:**
- Consumes: Prisma CLI `defineConfig` / `env` from `prisma/config`
- Produces: generated `@prisma/client` including `Tenant`; npm scripts `prisma:generate`, `prisma:migrate`, `prisma:push`

- [ ] **Step 1: Install Prisma**

From `projects/SutraAI/backend-api`:

```bash
npm install @prisma/client@^7
npm install -D prisma@^7
```

Do not install `pg`.

- [ ] **Step 2: Add schema, CLI config, scripts, tsconfig exclude, env example**

`backend-api/src/lib/postgres-prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

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

`backend-api/src/lib/postgres-prisma/prisma.config.ts`:

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

Add to `backend-api/package.json` `scripts` (keep existing `dev` / `build` / `test` / `start`):

```json
"prisma:generate": "prisma generate --config src/lib/postgres-prisma/prisma.config.ts",
"prisma:migrate": "prisma migrate dev --name init --config src/lib/postgres-prisma/prisma.config.ts",
"prisma:push": "prisma db push --config src/lib/postgres-prisma/prisma.config.ts"
```

`backend-api/tsconfig.json` — add exclude so `tsc` does not compile the CLI config:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "ignoreDeprecations": "6.0",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts"],
  "exclude": ["src/lib/postgres-prisma/prisma.config.ts"]
}
```

Append to `backend-api/.env.example` (do not remove existing OpenRouter / PORT lines):

```
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=
PGDATABASE=postgres
PGSSLMODE=
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
```

- [ ] **Step 3: Generate the Prisma client**

`env("DATABASE_URL")` in the config file requires the variable to be set even though generate does not open Postgres. Use a dummy URL:

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run prisma:generate
```

Expected: Prisma Client generated successfully. Do not run `prisma:migrate` or `prisma:push` in this task (those need a live database).

- [ ] **Step 4: Confirm existing tests still pass**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api && npm test
```

Expected: PASS (options tests + existing sutra/CORS/openrouter tests). No Postgres process required.

- [ ] **Step 5: Commit**

```bash
git add projects/SutraAI/backend-api/package.json \
  projects/SutraAI/backend-api/package-lock.json \
  projects/SutraAI/backend-api/src/lib/postgres-prisma/schema.prisma \
  projects/SutraAI/backend-api/src/lib/postgres-prisma/prisma.config.ts \
  projects/SutraAI/backend-api/tsconfig.json \
  projects/SutraAI/backend-api/.env.example
git commit -m "$(cat <<'EOF'
Add Prisma 7 PostgreSQL schema and nested CLI config.

EOF
)"
```

---

### Task 3: `DbService` facade and public barrel

**Files:**
- Create: `backend-api/src/lib/postgres-prisma/dbService.ts`
- Create: `backend-api/src/lib/postgres-prisma/index.ts`
- Test: `backend-api/test/lib/postgres-prisma/dbService.test.ts`

**Interfaces:**
- Consumes: `PostgresConnectionOptions`, `buildPostgresUrl` from `./options`; `PrismaClient` from `@prisma/client` (this file only)
- Produces:
  - `export type Tenant = { id: string; businessName: string; subdomainSlug: string; contactEmail: string; jsonState: unknown; isActive: boolean; planType: string }`
  - `export type CreateTenantInput = { businessName: string; subdomainSlug: string; contactEmail: string; planType: string; jsonState?: unknown; isActive?: boolean }`
  - `export class DbService { constructor(options: PostgresConnectionOptions, client?: DbClient); connect(): Promise<void>; disconnect(): Promise<void>; getTenantBySlug(slug: string): Promise<Tenant | null>; createTenant(data: CreateTenantInput): Promise<Tenant>; updateTenantState(slug: string, jsonState: unknown): Promise<Tenant> }`
  - Barrel re-exports options helpers, `DbService`, `Tenant`, `CreateTenantInput`, `PostgresConnectionOptions`, `RawPostgresOptions`. Does not re-export `PrismaClient`.

Define `DbClient` in `dbService.ts` as a structural type so tests never import `@prisma/client`.

- [ ] **Step 1: Write the failing test**

Create `backend-api/test/lib/postgres-prisma/dbService.test.ts`:

```ts
import { expect } from "chai";

import { DbService } from "../../../src/lib/postgres-prisma/dbService";
import type { PostgresConnectionOptions } from "../../../src/lib/postgres-prisma/options";

const unusedOptions: PostgresConnectionOptions = {
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "",
  database: "postgres",
  ssl: false
};

const sampleTenant = {
  id: "11111111-1111-1111-1111-111111111111",
  businessName: "Acme",
  subdomainSlug: "acme",
  contactEmail: "a@example.com",
  jsonState: { step: 1 },
  isActive: true,
  planType: "free"
};

describe("DbService", () => {
  it("getTenantBySlug returns null when missing", async () => {
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      tenant: {
        findUnique: async () => null,
        create: async () => sampleTenant,
        update: async () => sampleTenant
      }
    };
    const db = new DbService(unusedOptions, fake);
    expect(await db.getTenantBySlug("missing")).to.equal(null);
  });

  it("getTenantBySlug returns the mapped tenant", async () => {
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      tenant: {
        findUnique: async () => sampleTenant,
        create: async () => sampleTenant,
        update: async () => sampleTenant
      }
    };
    const db = new DbService(unusedOptions, fake);
    expect(await db.getTenantBySlug("acme")).to.deep.equal(sampleTenant);
  });

  it("createTenant passes required fields to prisma", async () => {
    let received: unknown;
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      tenant: {
        findUnique: async () => null,
        create: async (args: { data: unknown }) => {
          received = args.data;
          return sampleTenant;
        },
        update: async () => sampleTenant
      }
    };
    const db = new DbService(unusedOptions, fake);
    await db.createTenant({
      businessName: "Acme",
      subdomainSlug: "acme",
      contactEmail: "a@example.com",
      planType: "free"
    });
    expect(received).to.deep.equal({
      businessName: "Acme",
      subdomainSlug: "acme",
      contactEmail: "a@example.com",
      planType: "free"
    });
  });

  it("updateTenantState updates jsonState by subdomainSlug", async () => {
    let received: unknown;
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      tenant: {
        findUnique: async () => null,
        create: async () => sampleTenant,
        update: async (args: unknown) => {
          received = args;
          return { ...sampleTenant, jsonState: { step: 2 } };
        }
      }
    };
    const db = new DbService(unusedOptions, fake);
    await db.updateTenantState("acme", { step: 2 });
    expect(received).to.deep.equal({
      where: { subdomainSlug: "acme" },
      data: { jsonState: { step: 2 } }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api && NODE_ENV=test node --import tsx ./node_modules/mocha/bin/mocha "test/lib/postgres-prisma/dbService.test.ts"
```

Expected: FAIL (cannot resolve `dbService` module).

- [ ] **Step 3: Write `dbService.ts` and `index.ts`**

`backend-api/src/lib/postgres-prisma/dbService.ts` — import `PrismaClient` only (no `Prisma` type import):

```ts
import { PrismaClient } from "@prisma/client";

import {
  buildPostgresUrl,
  type PostgresConnectionOptions
} from "./options";

export type Tenant = {
  id: string;
  businessName: string;
  subdomainSlug: string;
  contactEmail: string;
  jsonState: unknown;
  isActive: boolean;
  planType: string;
};

export type CreateTenantInput = {
  businessName: string;
  subdomainSlug: string;
  contactEmail: string;
  planType: string;
  jsonState?: unknown;
  isActive?: boolean;
};

export type DbClient = {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  tenant: {
    findUnique(args: { where: { subdomainSlug: string } }): Promise<Tenant | null>;
    create(args: { data: CreateTenantInput }): Promise<Tenant>;
    update(args: {
      where: { subdomainSlug: string };
      data: { jsonState: unknown };
    }): Promise<Tenant>;
  };
};

function mapTenant(row: Tenant): Tenant {
  return {
    id: row.id,
    businessName: row.businessName,
    subdomainSlug: row.subdomainSlug,
    contactEmail: row.contactEmail,
    jsonState: row.jsonState,
    isActive: row.isActive,
    planType: row.planType
  };
}

export class DbService {
  private readonly client: DbClient;

  constructor(options: PostgresConnectionOptions, client?: DbClient) {
    this.client =
      client ??
      (new PrismaClient({
        datasourceUrl: buildPostgresUrl(options)
      }) as unknown as DbClient);
  }

  connect(): Promise<void> {
    return this.client.$connect();
  }

  disconnect(): Promise<void> {
    return this.client.$disconnect();
  }

  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.client.tenant.findUnique({
      where: { subdomainSlug: slug }
    });
    return row === null ? null : mapTenant(row);
  }

  async createTenant(data: CreateTenantInput): Promise<Tenant> {
    const row = await this.client.tenant.create({ data });
    return mapTenant(row);
  }

  async updateTenantState(slug: string, jsonState: unknown): Promise<Tenant> {
    const row = await this.client.tenant.update({
      where: { subdomainSlug: slug },
      data: { jsonState }
    });
    return mapTenant(row);
  }
}
```

`backend-api/src/lib/postgres-prisma/index.ts`:

```ts
export {
  appendPostgresOptions,
  buildPostgresUrl,
  resolvePostgresOptions,
  type PostgresConnectionOptions,
  type RawPostgresOptions
} from "./options";
export {
  DbService,
  type CreateTenantInput,
  type Tenant
} from "./dbService";
```

Do not export `DbClient` unless tests need it; they can pass a structural object.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api && NODE_ENV=test node --import tsx ./node_modules/mocha/bin/mocha "test/lib/postgres-prisma/**/*.test.ts"
```

Expected: PASS.

Confirm the import rule:

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api && rg '@prisma/client' --glob '*.ts'
```

Expected: only `src/lib/postgres-prisma/dbService.ts` (and possibly generated files under `node_modules`, which `rg` from `src`/`test` should not hit if you pass `--glob` on those trees):

```bash
rg '@prisma/client' src test
```

Expected: a single hit in `src/lib/postgres-prisma/dbService.ts`.

- [ ] **Step 5: Commit**

```bash
git add projects/SutraAI/backend-api/src/lib/postgres-prisma/dbService.ts \
  projects/SutraAI/backend-api/src/lib/postgres-prisma/index.ts \
  projects/SutraAI/backend-api/test/lib/postgres-prisma/dbService.test.ts
git commit -m "$(cat <<'EOF'
Add DbService as the only Prisma client wrapper.

EOF
)"
```

---

### Task 4: Wire connect/disconnect into the sutra process

**Files:**
- Modify: `backend-api/src/services/sutra/index.ts`
- Test: `backend-api/test/services/sutra/index.test.ts` (add CLI parse assertion only; keep HTTP tests on `createSutraApp`)

**Interfaces:**
- Consumes: `appendPostgresOptions`, `resolvePostgresOptions`, `DbService`, `RawPostgresOptions` from `../../lib/postgres-prisma`
- Produces: `export type SutraContext = ServerContext & { db?: DbService }`; `initializeApp(): Promise<SutraContext>` with `db` set after `connect()`; `SutraServer` optional `db`; `SIGINT`/`SIGTERM` disconnect on the `require.main` path only

- [ ] **Step 1: Write the failing test**

Append to `backend-api/test/services/sutra/index.test.ts` (keep existing HTTP tests):

```ts
import { initializeAppOptions } from "../../../src/services/sutra/index";

describe("initializeAppOptions postgres flags", () => {
  it("parses --pg-host", () => {
    const opts = initializeAppOptions([
      "node",
      "sutra",
      "--pg-host",
      "db.internal",
      "--pg-database",
      "sutra"
    ]);
    expect(opts.pgHost).to.equal("db.internal");
    expect(opts.pgDatabase).to.equal("sutra");
  });
});
```

Do **not** call `initializeApp` in tests (it would `connect()` to Postgres).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api && NODE_ENV=test node --import tsx ./node_modules/mocha/bin/mocha "test/services/sutra/index.test.ts"
```

Expected: FAIL (`opts.pgHost` undefined) until `appendPostgresOptions` is chained.

- [ ] **Step 3: Wire sutra**

Replace `backend-api/src/services/sutra/index.ts` with:

```ts
import { type Request, type Response, type Express } from "express";

import {
  ExpressServer,
  initializeServerContext,
  initializeServerOptions,
  type ServerContext,
  type ServerOptions
} from "../../lib/base-server";
import { appendOpenAIConfigOptions } from "../../lib/openrouter";
import {
  appendPostgresOptions,
  DbService,
  resolvePostgresOptions,
  type RawPostgresOptions
} from "../../lib/postgres-prisma";

export type SutraContext = ServerContext & { db?: DbService };

export const initializeAppOptions = (
  argv: string[] = process.argv
): Record<string, unknown> => {
  return appendPostgresOptions(appendOpenAIConfigOptions(initializeServerOptions()))
    .parse(argv)
    .opts() as Record<string, unknown>;
};

export const initializeApp = async (
  args: string[] = process.argv
): Promise<SutraContext> => {
  const opts = initializeAppOptions(args);
  const options: ServerOptions = {
    serviceName: String(opts.serviceName ?? "sutra"),
    host: String(opts.host ?? "0.0.0.0"),
    port: Number(opts.port ?? 3000),
    corsOrigins: Array.isArray(opts.corsOrigins)
      ? (opts.corsOrigins as string[])
      : []
  };
  const context = initializeServerContext(options);
  const db = new DbService(
    resolvePostgresOptions({
      pgHost: opts.pgHost as string | undefined,
      pgPort: opts.pgPort as string | number | undefined,
      pgUser: opts.pgUser as string | undefined,
      pgPassword: opts.pgPassword as string | undefined,
      pgDatabase: opts.pgDatabase as string | undefined,
      pgSsl: opts.pgSsl as boolean | string | undefined
    } satisfies RawPostgresOptions)
  );
  await db.connect();
  return { ...context, db };
};

export class SutraServer extends ExpressServer {
  public readonly db?: DbService;

  constructor(context: SutraContext) {
    super(context);
    this.db = context.db;
  }

  override registerRoutes(): void {
    super.registerRoutes();

    this.app.get("/sutra", (_req: Request, res: Response) => {
      res.status(200).json({
        status: "ok",
        service: this.options.serviceName
      });
    });
  }
}

export function createSutraApp(options?: ServerOptions): Express {
  const resolved: ServerOptions =
    options ?? {
      serviceName: "sutra",
      host: "0.0.0.0",
      port: 3000,
      corsOrigins: []
    };
  const context = initializeServerContext(resolved);
  const server = new SutraServer(context);
  server.registerRoutes();
  return server.getApp();
}

if (require.main === module) {
  initializeApp(process.argv)
    .then((context) => {
      const server = new SutraServer(context);
      server.run();

      const shutdown = (): void => {
        const done = context.db?.disconnect() ?? Promise.resolve();
        done
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {
            process.exit(0);
          });
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
```

No tenant routes. `createSutraApp` still does not call `DbService`.

Keep the `satisfies RawPostgresOptions` check so extra/misspelled pg fields fail at compile time.

- [ ] **Step 4: Run the full suite**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api && npm test
```

Expected: PASS with no Postgres. HTTP `/health` and `/sutra` still work via `createSutraApp`.

```bash
rg '@prisma/client' src test
```

Expected: only `src/lib/postgres-prisma/dbService.ts`.

- [ ] **Step 5: Commit**

```bash
git add projects/SutraAI/backend-api/src/services/sutra/index.ts \
  projects/SutraAI/backend-api/test/services/sutra/index.test.ts
git commit -m "$(cat <<'EOF'
Connect Prisma on sutra boot and disconnect on shutdown.

EOF
)"
```

---

## Spec coverage (self-review)

| Spec item | Task |
| --- | --- |
| `src/lib/postgres-prisma` folder + public barrel | 1, 3 |
| `prisma.config.ts` nested + `--config` scripts | 2 |
| `tsconfig` exclude CLI config | 2 |
| Tenant schema fields/defaults | 2 |
| `--pg-*` / URL / SSL | 1 |
| `.env.example` PG* + DATABASE_URL | 2 |
| `DbService` methods + injected client | 3 |
| Import rule (`@prisma/client` only in `dbService.ts`) | 3, 4 |
| `initializeApp` connect; optional `db`; no tenant routes | 4 |
| `createSutraApp` DB-free | 4 |
| SIGINT/SIGTERM disconnect | 4 |
| Unit tests, no live Postgres | 1, 3, 4 |
| Prisma ^7, no `pg` | 2 |
