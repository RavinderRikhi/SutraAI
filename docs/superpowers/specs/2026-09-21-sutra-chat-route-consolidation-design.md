# Sutra chat route consolidation design

Date: 2026-09-21  
Status: Approved for planning  
Scope: `projects/SutraAI/backend-api` — delete `routes/chat.ts`, register `POST /api/chat` in `SutraServer.registerRoutes`, shrink `chatHandler.ts` to utilities with no DB or logger

This spec **does not change** request/response shape, status codes, model, or prompt rules from `2026-09-21-sutra-chat-endpoint-design.md`. It only moves where those rules live.

## Goals

- Register `POST /api/chat` directly in `SutraServer.registerRoutes` in `src/services/sutra/index.ts`.
- Delete `src/services/sutra/routes/chat.ts`.
- Keep `chatHandler.ts` as chat-only utilities: parse/build/complete. No `DbService`, no `Logger`, no `Request`/`Response`, no `ChatDeps`, no `handleChatPost`.
- Use `this.db`, `this.openRouter`, and `this.log` only in `index.ts` (the class that already owns them).

## Non-goals

- New chat behavior, auth, streaming, or schema validation.
- Changing HTTP status codes or JSON error messages.
- Changing `createSutraApp` public API beyond how it reaches the same `registerRoutes`.
- Extracting a new orchestration module (`chatRoute.ts` or similar).

## Decisions

| Topic | Choice |
| --- | --- |
| Route registration | `this.app.post("/api/chat", …)` inside `SutraServer.registerRoutes` |
| Orchestration | Private method on `SutraServer` (e.g. `handleChatPost`) |
| Utilities | `chatHandler.ts` imported by `index.ts` |
| Router file | Deleted |
| `createSutraApp` | Still constructs `SutraServer` and calls `registerRoutes`; missing `db`/`openRouter` still yields 503 |

## Layout

```
backend-api/src/services/sutra/
  index.ts          # register POST /api/chat; DB, logger, OpenRouter I/O
  chatHandler.ts    # parse body, system prompt, parse model JSON, createChatCompletion
test/services/sutra/chat.test.ts
```

Delete: `src/services/sutra/routes/chat.ts`. Delete empty `routes/` if nothing else remains.

## `chatHandler.ts` exports

No Express, Prisma, or logger imports.

| Export | Role |
| --- | --- |
| `CHAT_MODEL` | `"qwen/qwen3.8-flash"` |
| `ChatMessage` | `{ role: "user" \| "assistant" \| "system"; content: string }` |
| `parseChatRequestBody(body: unknown)` | Returns `{ subdomainSlug, messages, jsonState }` or `null` (same validation as today) |
| `buildChatSystemPrompt(tenant, jsonState)` | Same prompt text as current `buildSystemPrompt` |
| `parseChatModelPayload(content)` | Same `{ reply, jsonState }` or `null` as current `parseModelPayload` |
| `createChatCompletion(openRouter, systemContent, messages)` | Calls `openRouter.chat.completions.create` with `CHAT_MODEL`, `[system, ...messages]`, `response_format: { type: "json_object" }`. Returns the completion. Throws on SDK failure. |

`createChatCompletion` takes the OpenRouter client as a **parameter**. It does not import a singleton or read env.

## `index.ts` orchestration

`registerRoutes`:

1. Existing `GET /sutra`.
2. `this.app.post("/api/chat", (req, res, next) => { void this.handleChatPost(req, res).catch(next); })`.

Private `handleChatPost(req, res)` (name may match; must not be exported from `chatHandler.ts`):

1. `parseChatRequestBody(req.body)` → 400 `"Invalid chat request"` if null.
2. If `this.db` or `this.openRouter` is undefined → 503 `"Chat unavailable"`.
3. `this.log.info("chat_request", { requestId, subdomainSlug, messageCount })`.
4. `this.db.getTenantBySlug` → 404 `"Tenant not found"` and `chat_error` info log if null.
5. `buildChatSystemPrompt` + `createChatCompletion(this.openRouter, …)`. Catch → `chat_error` error log + 502 `"Chat model failed"`.
6. `parseChatModelPayload` on `choices[0].message.content` → 502 `"Invalid model response"` if null.
7. `this.db.updateTenantState`. Prisma `P2025` → 404; other errors rethrow.
8. `this.log.info("chat_ok", …)` + 200 `{ reply, jsonState }`.

Local to `index.ts` only: `jsonError(res, status, message, requestId?)` and `isPrismaNotFound(error)`.

Error JSON shape unchanged: `{ message, requestId? }` when `req.requestId` is set.

## Tests

`test/services/sutra/chat.test.ts`:

- Do not import `createChatRouter`.
- Build the app with `new SutraServer({ ...initializeServerContext(options), db, openRouter })` then `registerRoutes()` / `getApp()`. Stub `db` and `openRouter` on that context.
- Keep existing HTTP cases: 503, 400, 404, 200 persist, 502 invalid JSON, 502 upstream throw.

Optional: `test/services/sutra/chatHandler.test.ts` for parse helpers only. HTTP tests remain the contract.

## Docs follow-up

When implementing, grep and update `2026-09-21-sutra-chat-endpoint-design.md` (and its plan if present) so they no longer describe `createChatRouter` / `ChatDeps` as current layout. Do not change product behavior in those docs.

## Out of scope leftovers

`--pg-connection-string` remains available in postgres options; this refactor does not touch CLI.
