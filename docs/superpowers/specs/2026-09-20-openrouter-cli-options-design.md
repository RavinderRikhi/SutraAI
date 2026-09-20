# OpenRouter Commander options design

Date: 2026-09-20  
Status: Drafted for review  
Scope: `projects/SutraAI/backend-api` — export `appendOpenAIConfigOptions` from `src/lib/openrouter.ts` and chain it in Sutra CLI parse

## Goals

- Add an exportable `appendOpenAIConfigOptions(program)` that registers OpenRouter-related Commander flags on an existing `Command` and returns that same object for chaining.
- Wire it into Sutra `initializeAppOptions` so `--openrouter-*` appears on `npm run dev` / `--help`.
- Do not construct an OpenRouter client at process start. Missing API key remains a factory error, not a boot failure.

## Non-Goals

- Passing parsed opts into `createOpenRouterClient`.
- Putting a client on `ServerContext`.
- Changing factory env resolution (still `OPENROUTER_API_KEY`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE`; hardcoded default base URL unless override is passed).
- New HTTP routes or LLM calls.
- Frontend changes.

## Decisions

| Topic | Choice |
| --- | --- |
| Helper shape | `appendOpenAIConfigOptions(program: Command): Command` — mutate in place, return `program`. |
| Flag names | `--openrouter-*` matching existing env vars (not `--openai-*`). |
| Sutra wiring | Chain in `initializeAppOptions` only. |
| Client at boot | No. |
| Factory | Unchanged. |

## Helper (`src/lib/openrouter.ts`)

Import `Command` from `commander`. Keep `createOpenRouterClient` as-is.

```ts
export function appendOpenAIConfigOptions(program: Command): Command {
  program
    .option("--openrouter-api-key <string>", "OpenRouter API key", process.env.OPENROUTER_API_KEY ?? "")
    .option("--openrouter-base-url <string>", "OpenRouter API base URL", process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL)
    .option("--openrouter-http-referer <string>", "OpenRouter HTTP-Referer header", process.env.OPENROUTER_HTTP_REFERER ?? "")
    .option("--openrouter-app-title <string>", "OpenRouter X-Title header", process.env.OPENROUTER_APP_TITLE ?? "");
  return program;
}
```

| Flag | `opts()` key | Default |
| --- | --- | --- |
| `--openrouter-api-key` | `openrouterApiKey` | `OPENROUTER_API_KEY` or `""` |
| `--openrouter-base-url` | `openrouterBaseUrl` | `OPENROUTER_BASE_URL` or `https://openrouter.ai/api/v1` |
| `--openrouter-http-referer` | `openrouterHttpReferer` | `OPENROUTER_HTTP_REFERER` or `""` |
| `--openrouter-app-title` | `openrouterAppTitle` | `OPENROUTER_APP_TITLE` or `""` |

Empty-string defaults are valid. Parse never throws for a missing key. `createOpenRouterClient` still throws `OPENROUTER_API_KEY is required` when the key is blank at create time.

`--openrouter-base-url` may default from `OPENROUTER_BASE_URL` even though the factory does not read that env var yet. That is intentional: CLI default vs factory default stay independent until a later mapper exists.

No new types. No `resolveOpenRouterOptions` helper in this change.

## Sutra (`src/services/sutra/index.ts`)

```ts
export const initializeAppOptions = (
  argv: string[] = process.argv
): Record<string, unknown> => {
  return appendOpenAIConfigOptions(initializeServerOptions())
    .parse(argv)
    .opts() as Record<string, unknown>;
};
```

`initializeApp` continues to map only `serviceName`, `host`, `port`, `corsOrigins`. Parsed `openrouter*` fields sit unused in `opts()`.

`createSutraApp` and callers that pass explicit `ServerOptions` are unchanged.

## Error handling

- Invalid Commander usage (unknown flags, missing required value after a flag) is Commander's existing exit/error behavior.
- Blank API key: CLI succeeds; factory still throws when someone later calls `createOpenRouterClient` without a key.
- No extra validation on referer, title, or base URL strings.

## Tests

Extend `backend-api/test/lib/openrouter.test.ts` (same file as the factory tests).

Use dummy argv prefixes `["node", "sutra", ...]` (Commander treats the first two entries as node and script). Restore any `OPENROUTER_*` env mutations in `afterEach` (same pattern as existing factory tests).

1. Calling `appendOpenAIConfigOptions(program)` returns the same `program` object (`===`).
2. Parse `["node", "sutra", "--openrouter-api-key", "sk-test"]`: `opts().openrouterApiKey` equals `"sk-test"`.
3. With `OPENROUTER_*` unset, parse `["node", "sutra"]`: `openrouterApiKey`, `openrouterHttpReferer`, and `openrouterAppTitle` are `""`; `openrouterBaseUrl` is `https://openrouter.ai/api/v1`.
4. Existing `createOpenRouterClient` tests remain.

No new Sutra HTTP tests. No `--help` snapshot.

## Success criteria

- `appendOpenAIConfigOptions` is exported from `openrouter.ts` and returns the same `Command` instance it was given.
- Sutra CLI parse includes the four flags.
- `cd backend-api && npm test` passes.
- Process start still succeeds without `OPENROUTER_API_KEY`.

## Implementation notes

- Reuse `DEFAULT_BASE_URL` already in `openrouter.ts`.
- Commander camelCase for kebab flags is the documented mapping; do not add aliases.
- Keep the helper in `src/lib` so `tsc` `rootDir: src` includes it.
