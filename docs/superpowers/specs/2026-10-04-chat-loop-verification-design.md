# Chat Loop Verification (Manual Checklist + Live Smoke)

## Goal

Prove the end-to-end SutraAI chat loop works against a running local stack: OpenRouter processes the prompt, Prisma persists updated `jsonState` for tenant `acme`, the API returns `reply` + `jsonState`, and the dashboard preview updates. Deliver a README manual checklist plus a lightweight live smoke script. Do not change the `/api/chat` contract or UI behavior.

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Deliverable | Both: README checklist + automated live smoke |
| Smoke style | Standalone script against already-running backend (no server bootstrap) |
| Script path | `backend-api/scripts/smoke-test.ts` |
| DB access | Reuse `DbService` + `resolvePostgresOptions` (same path as sutra) |
| API field | `jsonState` (not `clientState`) |
| Default API base | `http://localhost:5000` via `SMOKE_API_URL` |
| Default tenant | `acme` via `SMOKE_SLUG` |
| Persistence proof | Unique marker `tagline = smoke-<timestamp>` must appear in DB after call |
| Checklist location | Short section in root `README.md` under Quick start |
| Mocha unit tests | Unchanged (mocked OpenRouter/DB remain) |
| Out of scope | Tenant seeding, starting servers, Playwright, CI always-on live calls |

## Architecture

```
Manual path                          Smoke path
-----------                          ----------
Start backend + web                  Backend already listening
Browser: ChatPanel POST /api/chat    scripts/smoke-test.ts POST /api/chat
PreviewPanel + DebugDrawer eyes      Assert HTTP + body shape
                                     DbService.getTenantBySlug → marker check
```

No new services. The smoke script is a client of the running API and a direct reader of Postgres through the existing Prisma abstraction.

## Smoke script

**File:** `backend-api/scripts/smoke-test.ts`  
**npm script:** `"smoke": "tsx scripts/smoke-test.ts"` in `backend-api/package.json`

### Config

| Env | Default | Purpose |
| --- | --- | --- |
| `SMOKE_API_URL` | `http://localhost:5000` | Base URL of running sutra service |
| `SMOKE_SLUG` | `acme` | Tenant subdomain slug |
| Postgres | Existing `DATABASE_URL` / `PG_*` helpers | Same resolution as sutra service |

### Flow

1. Resolve Postgres options; construct `DbService`; `connect()`.
2. `getTenantBySlug(SMOKE_SLUG)`; exit non-zero if missing.
3. Build `marker = "smoke-" + Date.now()`.
4. `POST ${SMOKE_API_URL}/api/chat` with:
   - `subdomainSlug`: slug
   - `messages`: one user turn asking to set `tagline` to exactly the marker (keep other fields)
   - `jsonState`: current tenant `jsonState` if it is an object, else `{}`
5. Assert status `200`.
6. Assert body has non-empty string `reply` and non-empty object `jsonState`.
7. Re-read tenant via `DbService`; assert persisted `jsonState.tagline === marker`.
8. `disconnect()`; print `smoke ok` (slug + marker); exit `0`.

### Errors

Any failure prints a one-line reason to stderr and exits `1`:

- Tenant not found
- Fetch/network failure
- Non-200 status (include status + response `message` when present)
- Missing/empty `reply` or `jsonState`
- DB tagline does not equal marker (model or persistence failure)

## Manual checklist (README)

Add **Verify chat loop** under Quick start:

1. Start backend (smoke default port **5000**; if different, set `SMOKE_API_URL`) and frontend (`web` on 5173 with CORS allowing the Vite origin).
2. Open the dashboard; subdomain slug `acme` (tenant row must exist).
3. Send a prompt that should change visible content (e.g. hero/tagline).
4. Confirm: assistant reply appears; Show JSON reflects new `jsonState`; right-side preview updates without refresh.
5. Optionally run `npm run smoke` in `backend-api/` to assert API + Prisma persistence.

## Success criteria

- Manual: one chat turn yields a reply and an immediately updated preview for `acme`.
- Smoke: exit `0` only when HTTP 200, response shape is valid, and Prisma shows the unique marker on the tenant row.
- No changes to `chatHandler`, `SutraServer` route behavior, or dashboard components for this work.

## Testing notes

- Existing Mocha tests continue to mock OpenRouter/DB; they are not a substitute for this live smoke.
- Smoke is opt-in and local-only; it is not added to the default `npm test` suite.
- Prerequisite: seeded `Tenant` with `subdomainSlug = acme`, working OpenRouter key on the running server, reachable Postgres.
