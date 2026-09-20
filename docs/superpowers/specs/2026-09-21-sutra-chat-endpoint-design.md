# Sutra POST /api/chat design

Date: 2026-09-21  
Status: Drafted for review  
Scope: `projects/SutraAI` — `POST /api/chat` on the sutra Express service, Prisma `jsonState` persistence, minimal Vite chat UI

## Goals

- Add `POST /api/chat` that accepts `subdomainSlug`, `messages`, and client `jsonState`.
- Call OpenRouter via the **existing** `SutraServer.openRouter` client (`createOpenRouterClient` at boot), model `qwen/qwen3.8-flash`, with `response_format: { type: "json_object" }`.
- Persist the model’s full `jsonState` with `DbService.updateTenantState`.
- Return `{ reply, jsonState }` so a live preview can re-render.
- Add a minimal web form that posts to this endpoint (keep the health button).

## Non-Goals

- Auth, sessions, or API keys on the chat route.
- Gating on `tenant.isActive`.
- Updating Prisma columns other than `jsonState` (e.g. `businessName`).
- Creating a tenant if the slug is missing.
- A second OpenAI client or reading `OPENROUTER_API_KEY` in the route (boot factory + Base64 decode stay as-is).
- Streaming responses, multi-turn message persistence in Postgres (history lives in the request `messages` array only).
- Strict JSON Schema validation of every `jsonState` field beyond “object”.

## Decisions

| Topic | Choice |
| --- | --- |
| Layout | `chatHandler.ts` + `createChatRouter` mounted at `/api` |
| LLM client | `this.openRouter` from context, not `new OpenAI` in the handler |
| Prompt state | Client `jsonState` is authoritative for this turn |
| Tenant | Must exist (`getTenantBySlug`); missing → 404; inactive tenants still allowed |
| Model JSON | `{ reply: string, jsonState: object }` full site config |
| UI | Backend + minimal Vite form |

## Layout

```
backend-api/src/services/sutra/
  index.ts                 # mount /api router
  routes/chat.ts           # createChatRouter(deps)
  chatHandler.ts           # validate, LLM, persist
web/src/App.tsx            # health + chat form
test/services/sutra/chat.test.ts
```

## Request / response

**`POST /api/chat`** JSON body:

```ts
{
  subdomainSlug: string;   // non-empty after trim
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;       // non-empty after trim
  }>;                      // length >= 1
  jsonState: object;       // current site state from the client
}
```

**200:**

```json
{ "reply": "<assistant prose>", "jsonState": { } }
```

`jsonState` is the **complete** website configuration after this turn (not a patch). Suggested keys the system prompt asks for: `businessName`, `tagline`, `accentColors` (`{ primary, secondary }`), `sections` (array of `{ id, type, content }`). Extra keys from the model are stored as-is.

## Handler flow

`handleChatPost(req, res, deps)` with `deps: { db?: DbService; openRouter?: OpenAI; log: Logger }`.

1. Validate body → **400** `{ message }` (and `requestId` if present on `req`).
2. If `db` or `openRouter` is missing → **503** `{ message: "Chat unavailable" }`.
3. `getTenantBySlug(subdomainSlug)` → **404** `{ message: "Tenant not found" }` if null.
4. System prompt: SutraAI website editor; must output JSON `{ reply, jsonState }`; merge user intent into provided current `jsonState`; return full `jsonState`. Include tenant `subdomainSlug` / `businessName` as context. Include current `jsonState` as JSON in the system message.
5. `openRouter.chat.completions.create({ model: "qwen/qwen3.8-flash", messages: [system, ...body.messages], response_format: { type: "json_object" } })`.
6. Parse `choices[0].message.content` as JSON. Require `typeof reply === "string"` (non-empty after trim) and `jsonState` a non-null object (not array) → else **502** `{ message: "Invalid model response" }`.
7. `updateTenantState(subdomainSlug, jsonState)`. Prisma not-found (`P2025` or message) → **404**. Other DB errors → **500** via throw to Express handler.
8. SDK / network errors from the completion call → **502** `{ message: "Chat model failed" }`.
9. **200** `{ reply, jsonState }` (trimmed `reply`).

## Router

```ts
export function createChatRouter(deps: ChatDeps): Router {
  const router = Router();
  router.post("/chat", (req, res, next) => {
    void handleChatPost(req, res, deps).catch(next);
  });
  return router;
}
```

In `SutraServer.registerRoutes`, after `super.registerRoutes()` and existing `GET /sutra`:

```ts
this.app.use("/api", createChatRouter({
  db: this.db,
  openRouter: this.openRouter,
  log: this.log
}));
```

`createSutraApp` stays DB/LLM-free; chat on that app returns **503**.

## Logging

- `chat_request`: `requestId`, `subdomainSlug`, `messageCount` (not message text).
- `chat_ok`: `requestId`, `subdomainSlug`.
- `chat_error`: `requestId`, `subdomainSlug` if known, `message`.
- Never log API keys or full `jsonState` (can be large).

## Web (`web/src/App.tsx`)

Keep heading + health check.

Add:

- Input: `subdomainSlug`
- Textarea: `jsonState` (default `{}`); parse as JSON before send; client-side error if invalid JSON
- Input: latest user message
- Button Send: `POST ${VITE_API_URL}/api/chat` with `{ subdomainSlug, messages: [{ role: "user", content }], jsonState }`
- Display `reply` and pretty-printed `jsonState`
- On 200, set textarea to the returned `jsonState` for the next turn
- On non-OK, show `body.message` or status text

No router library. No conversation history in the UI beyond the last reply (YAGNI); only the current user message is sent each time unless we later append history — **this increment sends only the latest user message** as `messages` (length 1). Spec is explicit: UI does not accumulate `messages` array in this increment.

## Tests

Mocha + chai + supertest. Stub `DbService` methods and `openRouter.chat.completions.create`. Mount `createChatRouter` on a tiny Express app with `express.json()`.

| Case | Expectation |
| --- | --- |
| Missing `subdomainSlug` | 400 |
| Empty `messages` | 400 |
| `jsonState` not an object | 400 |
| Tenant null | 404 |
| Valid stub LLM JSON | 200; `updateTenantState` called with parsed object; body has `reply` and `jsonState` |
| LLM content not JSON / missing `reply` | 502 Invalid model response |
| Completions throw | 502 Chat model failed |
| Router without db/openRouter | 503 |

Existing `/health` and `/sutra` tests unchanged.

## Error handling summary

| Status | When |
| --- | --- |
| 400 | Validation |
| 404 | Unknown slug or P2025 on update |
| 502 | Model HTTP/SDK failure or unparseable JSON |
| 503 | Missing deps on the process (tests / miswired server) |
| 500 | Unexpected / DB errors other than not-found |

## Success criteria

- `cd backend-api && npm test` passes without live OpenRouter or Postgres.
- Process with db + openRouter: `POST /api/chat` with a real tenant slug updates `jsonState` and returns `{ reply, jsonState }`.
- Vite page can send a message and show reply + JSON (manual).

## Implementation notes

- Reuse `req.requestId` from existing middleware.
- Model id string exactly `qwen/qwen3.8-flash`.
- Do not import `@prisma/client` in sutra routes.
