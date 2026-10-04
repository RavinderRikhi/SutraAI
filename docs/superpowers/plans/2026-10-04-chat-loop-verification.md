# Chat Loop Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live local smoke script that hits running `/api/chat` and verifies Prisma persistence for tenant `acme`, plus a short README manual checklist for the dashboard preview loop.

**Architecture:** Opt-in `backend-api/scripts/smoke-test.ts` POSTs to an already-running sutra server, asserts HTTP 200 + `reply`/`jsonState`, then re-reads the tenant via existing `DbService` and requires `jsonState.tagline === smoke-<timestamp>`. Pure assertion helpers live beside the script with an assert-based self-check. README documents the manual browser walkthrough. No chat handler or UI changes.

**Tech Stack:** Node.js `fetch`, existing `tsx`, `DbService`, `resolvePostgresOptions`. No new dependencies. Mocha suite untouched.

## Global Constraints

- API field name is `jsonState` (not `clientState`).
- Default API base: `http://localhost:5000` via `SMOKE_API_URL`.
- Default tenant slug: `acme` via `SMOKE_SLUG`.
- Persistence proof: unique marker `tagline = smoke-<timestamp>` must appear in DB after the call.
- Smoke assumes backend is already running; do not start servers or seed tenants.
- Do not change `chatHandler`, `SutraServer` route behavior, or dashboard components.
- Do not add smoke to default `npm test`.
- No new npm dependencies.
- Spec: `docs/superpowers/specs/2026-10-04-chat-loop-verification-design.md`
- Note: `docs/superpowers/**` is gitignored by `**superpowers**` — use `git add -f` when committing under that path.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend-api/scripts/smokeHelpers.ts` | Pure env/response/tagline helpers used by the smoke script |
| `backend-api/scripts/smokeHelpers.check.ts` | Assert-based self-check for helpers |
| `backend-api/scripts/smoke-test.ts` | Live smoke: POST `/api/chat` + Prisma marker verify |
| `backend-api/package.json` | Add `"smoke": "tsx scripts/smoke-test.ts"` |
| `README.md` | Add **Verify chat loop** under Quick start |

---

### Task 1: Smoke helpers + self-check + live smoke script

**Files:**
- Create: `backend-api/scripts/smokeHelpers.ts`
- Create: `backend-api/scripts/smokeHelpers.check.ts`
- Create: `backend-api/scripts/smoke-test.ts`
- Modify: `backend-api/package.json` (scripts only)
- Test: `backend-api/scripts/smokeHelpers.check.ts`

**Interfaces:**
- Consumes:
  - `resolvePostgresOptions(raw: RawPostgresOptions): PostgresConnectionOptions` from `../src/lib/postgres-prisma`
  - `DbService` from `../src/lib/postgres-prisma`
- Produces:
  - `export function isRecord(value: unknown): value is Record<string, unknown>`
  - `export function isNonEmptyRecord(value: unknown): value is Record<string, unknown>`
  - `export function taglineOf(jsonState: unknown): string | undefined`
  - `export function buildMarker(nowMs?: number): string`
  - `export function buildSmokeUserContent(marker: string): string`
  - `export type SmokeConfig = { apiUrl: string; slug: string; pg: RawPostgresOptions }`
  - `export function readSmokeConfig(env: NodeJS.ProcessEnv): SmokeConfig`
  - `export function assertChatSuccess(status: number, body: unknown): { reply: string; jsonState: Record<string, unknown> }`

- [ ] **Step 1: Write the failing self-check**

Create `backend-api/scripts/smokeHelpers.check.ts`:

```ts
import assert from "node:assert/strict";
import {
  assertChatSuccess,
  buildMarker,
  buildSmokeUserContent,
  isNonEmptyRecord,
  isRecord,
  readSmokeConfig,
  taglineOf
} from "./smokeHelpers.ts";

assert.equal(isRecord(null), false);
assert.equal(isRecord([]), false);
assert.equal(isRecord({ a: 1 }), true);

assert.equal(isNonEmptyRecord({}), false);
assert.equal(isNonEmptyRecord({ a: 1 }), true);

assert.equal(taglineOf({ tagline: "hi" }), "hi");
assert.equal(taglineOf({ tagline: "  " }), undefined);
assert.equal(taglineOf({}), undefined);
assert.equal(taglineOf(null), undefined);

assert.equal(buildMarker(1700000000000), "smoke-1700000000000");
assert.equal(
  buildSmokeUserContent("smoke-1"),
  "Set tagline to exactly: smoke-1. Keep other fields."
);

const cfg = readSmokeConfig({
  SMOKE_API_URL: "http://127.0.0.1:5000",
  SMOKE_SLUG: "acme",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres"
});
assert.equal(cfg.apiUrl, "http://127.0.0.1:5000");
assert.equal(cfg.slug, "acme");
assert.equal(cfg.pg.pgConnectionString, "postgresql://postgres:postgres@localhost:5432/postgres");

const defaults = readSmokeConfig({});
assert.equal(defaults.apiUrl, "http://localhost:5000");
assert.equal(defaults.slug, "acme");

const ok = assertChatSuccess(200, {
  reply: "Done",
  jsonState: { tagline: "smoke-1", businessName: "Acme" }
});
assert.equal(ok.reply, "Done");
assert.equal(ok.jsonState.tagline, "smoke-1");

assert.throws(() => assertChatSuccess(500, { message: "boom" }), /500/);
assert.throws(() => assertChatSuccess(200, { reply: "", jsonState: { a: 1 } }), /reply/);
assert.throws(() => assertChatSuccess(200, { reply: "x", jsonState: {} }), /jsonState/);

console.log("smokeHelpers.check: ok");
```

- [ ] **Step 2: Run self-check to verify it fails**

Run:

```bash
cd backend-api && npx tsx scripts/smokeHelpers.check.ts
```

Expected: FAIL (module `./smokeHelpers.ts` not found / cannot resolve).

- [ ] **Step 3: Implement helpers**

Create `backend-api/scripts/smokeHelpers.ts`:

```ts
import type { RawPostgresOptions } from "../src/lib/postgres-prisma";

export type SmokeConfig = {
  apiUrl: string;
  slug: string;
  pg: RawPostgresOptions;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyRecord(
  value: unknown
): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length > 0;
}

export function taglineOf(jsonState: unknown): string | undefined {
  if (!isRecord(jsonState)) {
    return undefined;
  }
  const tagline = jsonState.tagline;
  if (typeof tagline !== "string") {
    return undefined;
  }
  const trimmed = tagline.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function buildMarker(nowMs: number = Date.now()): string {
  return `smoke-${nowMs}`;
}

export function buildSmokeUserContent(marker: string): string {
  return `Set tagline to exactly: ${marker}. Keep other fields.`;
}

export function readSmokeConfig(env: NodeJS.ProcessEnv): SmokeConfig {
  const apiUrl = (env.SMOKE_API_URL ?? "http://localhost:5000").trim();
  const slug = (env.SMOKE_SLUG ?? "acme").trim();
  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  const pg: RawPostgresOptions =
    databaseUrl !== ""
      ? { pgConnectionString: databaseUrl }
      : {
          pgHost: env.PGHOST ?? env.PG_HOST ?? "localhost",
          pgPort: env.PGPORT ?? env.PG_PORT ?? "5432",
          pgUser: env.PGUSER ?? env.PG_USER ?? "postgres",
          pgPassword: env.PGPASSWORD ?? env.PG_PASSWORD ?? "",
          pgDatabase: env.PGDATABASE ?? env.PG_DATABASE ?? "postgres",
          pgSsl: env.PGSSL ?? env.PG_SSL
        };
  return { apiUrl, slug, pg };
}

export function assertChatSuccess(
  status: number,
  body: unknown
): { reply: string; jsonState: Record<string, unknown> } {
  if (status !== 200) {
    const message =
      isRecord(body) && typeof body.message === "string"
        ? body.message
        : "request failed";
    throw new Error(`Expected HTTP 200, got ${status}: ${message}`);
  }
  if (!isRecord(body)) {
    throw new Error("Response body must be an object");
  }
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if (reply === "") {
    throw new Error("Response missing non-empty reply");
  }
  if (!isNonEmptyRecord(body.jsonState)) {
    throw new Error("Response missing non-empty jsonState object");
  }
  return { reply, jsonState: body.jsonState };
}
```

- [ ] **Step 4: Run self-check to verify it passes**

Run:

```bash
cd backend-api && npx tsx scripts/smokeHelpers.check.ts
```

Expected: `smokeHelpers.check: ok` and exit `0`.

- [ ] **Step 5: Implement live smoke script**

Create `backend-api/scripts/smoke-test.ts`:

```ts
import {
  DbService,
  resolvePostgresOptions
} from "../src/lib/postgres-prisma";
import {
  assertChatSuccess,
  buildMarker,
  buildSmokeUserContent,
  isRecord,
  readSmokeConfig,
  taglineOf
} from "./smokeHelpers";

async function main(): Promise<void> {
  const config = readSmokeConfig(process.env);
  const pgOptions = resolvePostgresOptions(config.pg);
  const db = new DbService(pgOptions);
  await db.connect();

  try {
    const tenant = await db.getTenantBySlug(config.slug);
    if (tenant === null) {
      throw new Error(`Tenant not found: ${config.slug}`);
    }

    const marker = buildMarker();
    const jsonState = isRecord(tenant.jsonState) ? tenant.jsonState : {};

    let status: number;
    let body: unknown;
    try {
      const response = await fetch(`${config.apiUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomainSlug: config.slug,
          messages: [{ role: "user", content: buildSmokeUserContent(marker) }],
          jsonState
        })
      });
      status = response.status;
      body = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Fetch failed: ${message}`);
    }

    assertChatSuccess(status, body);

    const updated = await db.getTenantBySlug(config.slug);
    if (updated === null) {
      throw new Error(`Tenant missing after chat: ${config.slug}`);
    }
    const persisted = taglineOf(updated.jsonState);
    if (persisted !== marker) {
      throw new Error(
        `DB tagline mismatch: expected ${marker}, got ${persisted ?? "<missing>"}`
      );
    }

    console.log(`smoke ok slug=${config.slug} marker=${marker}`);
  } finally {
    await db.disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`smoke failed: ${message}`);
  process.exit(1);
});
```

- [ ] **Step 6: Wire npm script**

In `backend-api/package.json`, add to `"scripts"`:

```json
"smoke": "tsx scripts/smoke-test.ts"
```

Keep existing scripts unchanged.

- [ ] **Step 7: Sanity-run helpers again; dry-check smoke fails without server**

Run:

```bash
cd backend-api && npx tsx scripts/smokeHelpers.check.ts
```

Expected: `smokeHelpers.check: ok`.

If no backend is listening on port 5000 (or set `SMOKE_API_URL` to a dead port), run:

```bash
cd backend-api && SMOKE_API_URL=http://127.0.0.1:9 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run smoke
```

Expected: exit `1` with `smoke failed: Fetch failed: ...` (or tenant/DB error if Postgres is also unreachable — either proves the script exits non-zero cleanly).

When backend is up on the smoke URL with OpenRouter + seeded `acme` + matching `DATABASE_URL`/`PG_*`, expected success:

```bash
cd backend-api && SMOKE_API_URL=http://localhost:5000 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run smoke
```

Expected: `smoke ok slug=acme marker=smoke-...` and exit `0`.

Note: if the running server uses a different port (e.g. 3000), set `SMOKE_API_URL` accordingly. If `PGPASSWORD` is base64 (CLI convention), prefer discrete `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` instead of a plaintext `DATABASE_URL`.

- [ ] **Step 8: Commit**

```bash
git add backend-api/scripts/smokeHelpers.ts backend-api/scripts/smokeHelpers.check.ts backend-api/scripts/smoke-test.ts backend-api/package.json
git commit -m "$(cat <<'EOF'
Add live /api/chat smoke script with Prisma marker check.

EOF
)"
```

---

### Task 2: README manual verification checklist

**Files:**
- Modify: `README.md` (Quick start section)

**Interfaces:**
- Consumes: `npm run smoke` from Task 1
- Produces: documented manual steps for chat → preview verification

- [ ] **Step 1: Insert Verify chat loop section**

In `README.md`, after the **Frontend** bullet list under Quick start and before **Tests**, insert:

```markdown
**Verify chat loop:**

1. Start backend (smoke default port **5000**; if different, set `SMOKE_API_URL`) and frontend (`npm run dev` in `web/`, port 5173; CORS must allow the Vite origin).
2. Open the dashboard; keep subdomain slug `acme` (tenant row must exist).
3. Send a prompt that should change visible content (e.g. hero copy or tagline).
4. Confirm: assistant reply appears; **Show JSON** reflects the new `jsonState`; the right-side preview updates without a page refresh.
5. Optionally run `npm run smoke` in `backend-api/` (with `DATABASE_URL` or `PG_*` set) to assert API + Prisma persistence via a unique `tagline` marker.
```

Keep the existing **Tests** line after this section.

- [ ] **Step 2: Skim README for consistency**

Confirm Quick start still mentions seeding a tenant and that the new section references `jsonState`, preview, and `npm run smoke` without inventing new API fields.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
Document manual chat loop verification in README.

EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| README manual checklist | Task 2 |
| `backend-api/scripts/smoke-test.ts` | Task 1 |
| Reuse `DbService` / `resolvePostgresOptions` | Task 1 Step 5 |
| Default API `http://localhost:5000` / `SMOKE_API_URL` | Task 1 helpers |
| `jsonState` field (not `clientState`) | Task 1 POST body |
| Assert 200 + reply + non-empty `jsonState` | `assertChatSuccess` |
| Prisma confirm tagline marker for `acme` | Task 1 Step 5 |
| `npm run smoke` alias | Task 1 Step 6 |
| No Mocha/CI always-on live; no UI/API contract changes | Global constraints |

No placeholders remain. Helper names are consistent across check file and smoke script.
