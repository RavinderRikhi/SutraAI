# Sutra OpenRouter client on context design

Date: 2026-09-21  
Status: Drafted for review  
Scope: `projects/SutraAI/backend-api` — Base64 API key in `createOpenRouterClient`, boot-time client on `SutraContext` / `SutraServer`

## Goals

- Construct `createOpenRouterClient` during `initializeApp` and attach the `OpenAI` instance on `SutraContext` / `SutraServer` as `openRouter` (same optional pattern as `db`).
- Pass parsed CLI values into the factory: `apiKey` from `--openrouter-api-key`, `baseURL` from `--openrouter-base-url`.
- Treat `apiKey` (CLI or `OPENROUTER_API_KEY`) as **Base64-encoded**; decode before `new OpenAI(...)`.
- Fail process boot when the key is missing, invalid Base64, or decodes to empty (same severity as Postgres connect failure).
- Log `openrouter_client_created` with `baseURL` only (never the key).

## Non-Goals

- HTTP routes that call OpenRouter.
- Extending the factory to accept `--openrouter-http-referer` / `--openrouter-app-title` from CLI (referer/title stay env-only).
- Requiring OpenRouter in `createSutraApp` or HTTP tests.
- Plaintext API keys without Base64 encoding (no fallback to raw string).

## Supersedes (partial)

`docs/superpowers/specs/2026-09-20-openrouter-cli-options-design.md`:

- “Do not construct an OpenRouter client at process start” — **reversed** for `initializeApp` / `require.main` only.
- “Putting a client on `ServerContext`” — **allowed** as optional `openRouter` on `SutraContext`.
- “Passing parsed opts into `createOpenRouterClient`” — **required** for `apiKey` and `baseURL` on boot.

`appendOpenAIConfigOptions` and Sutra CLI chaining remain unchanged.

## Decisions

| Topic | Choice |
| --- | --- |
| Boot failure | Missing/invalid key fails `initializeApp` → exit 1 |
| Context field | `openRouter?: OpenAI` on `SutraContext`; `SutraServer.openRouter` optional |
| CLI → factory | `openrouterApiKey`, `openrouterBaseUrl` from parsed opts |
| Key encoding | Base64 only; decode in `createOpenRouterClient` |
| Invalid Base64 | Throw `OPENROUTER_API_KEY must be valid base64` |
| Missing key | Throw `OPENROUTER_API_KEY is required` |
| Referer / title | Still `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE` env only |
| Tests | Factory unit tests; `createSutraApp` unchanged |

## `createOpenRouterClient` (`src/lib/openrouter.ts`)

Resolution order for encoded key:

1. `encoded = (overrides.apiKey ?? process.env.OPENROUTER_API_KEY ?? "").trim()`
2. If `encoded === ""` → throw `OPENROUTER_API_KEY is required`
3. Decode with strict Base64 validation (see below). On failure or empty decoded plaintext → throw `OPENROUTER_API_KEY must be valid base64`
4. `baseURL = overrides.baseURL ?? DEFAULT_BASE_URL` (`https://openrouter.ai/api/v1`)
5. Build `defaultHeaders` from env referer/title (unchanged)
6. Return `new OpenAI({ apiKey: decoded, baseURL, defaultHeaders? })`

### Base64 validation

- Input must match standard Base64 charset with optional `=` padding.
- Decode to UTF-8 string; after trim, decoded value must be non-empty.
- Reject inputs that do not round-trip under normalized Base64 encoding (catches garbage that `Buffer` might otherwise accept loosely).

Use Node `Buffer`; no new dependencies.

## Sutra wiring (`src/services/sutra/index.ts`)

Import `createOpenRouterClient` from `../../lib/openrouter`.

```ts
export type SutraContext = ServerContext & {
  db?: DbService;
  openRouter?: OpenAI;
};
```

In `initializeApp`, after Postgres connect and `postgres_connected` log:

```ts
const openRouter = createOpenRouterClient({
  apiKey: String(opts.openrouterApiKey ?? ""),
  baseURL: String(opts.openrouterBaseUrl ?? "")
});
context.log.info("openrouter_client_created", {
  baseURL: openRouter.baseURL
});
return { ...context, db, openRouter };
```

`SutraServer` constructor assigns `this.openRouter = context.openRouter`.

`createSutraApp`: no `openRouter`, no factory call.

`require.main` catch unchanged: factory errors exit the process.

## Configuration

`backend-api/.env.example`:

- Comment that `OPENROUTER_API_KEY` must be the **Base64 encoding** of the real OpenRouter API key (not the raw key).

Example for local dev: `echo -n 'sk-or-...' | base64 -w0`

## Error handling

| Condition | Error |
| --- | --- |
| Blank encoded key | `OPENROUTER_API_KEY is required` |
| Invalid Base64 or empty decode | `OPENROUTER_API_KEY must be valid base64` |
| Postgres failure | Unchanged (reject before or independent of OpenRouter) |

No HTTP mapping of these errors in this increment.

## Tests (`test/lib/openrouter.test.ts`)

Update existing success test to pass Base64-encoded key (e.g. `Buffer.from("test").toString("base64")`).

| Test | Expectation |
| --- | --- |
| Valid Base64 override | Client `baseURL` is OpenRouter default or override |
| Missing key (env + override empty) | `OPENROUTER_API_KEY is required` |
| Invalid Base64 string | `OPENROUTER_API_KEY must be valid base64` |
| Base64 decoding to whitespace only | `OPENROUTER_API_KEY must be valid base64` |
| `appendOpenAIConfigOptions` tests | Unchanged |

No new test calling `initializeApp` without Postgres.

## Success criteria

- `cd backend-api && npm test` passes.
- `npm run dev` / debug launch fails fast without a valid Base64 key in env or CLI.
- With valid Base64 `OPENROUTER_API_KEY` in `.env`, boot logs `openrouter_client_created` then `server_started`.
- `createSutraApp` tests still pass without any key.

## Implementation notes

- Export type `OpenAI` usage: import type from `openai` on `SutraContext` if needed for typing.
- Do not log decoded or encoded keys.
- Commander may supply default `openrouterBaseUrl`; passing empty string to factory should still fall back via `?? DEFAULT_BASE_URL` if implemented as `overrides.baseURL || DEFAULT` only when override is undefined — prefer `String(opts.openrouterBaseUrl ?? "")` only if empty should mean default; use `opts.openrouterBaseUrl as string | undefined` and pass only when defined, else omit `baseURL` override so factory default applies.

Clarification for implementer: pass `baseURL` override only when `opts.openrouterBaseUrl` is a non-empty string after trim; otherwise omit `baseURL` from overrides so factory uses `DEFAULT_BASE_URL`.
