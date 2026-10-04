# Chat RAG Context Injection — Tenant-Scoped Prompt Grounding

## Goal

Update `handleChatPost` so that before calling OpenRouter it loads tenant document chunks, injects a source-labeled business-context block (when non-empty) with guardrails into the system prompt, keeps JSON-object response enforcement, and continues to persist `jsonState` via Prisma.

Builds on [2026-10-04-document-chunk-rag-db-design.md](./2026-10-04-document-chunk-rag-db-design.md) and [2026-10-05-document-upload-pipeline-design.md](./2026-10-05-document-upload-pipeline-design.md).

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Approach | Extend `chatHandler` helpers; orchestrate in `handleChatPost` (Approach 1) |
| Retrieval | `await this.db.getTenantContextChunks(subdomainSlug)` — all tenant chunks, no embeddings/ranking |
| Truncation | Cap at `maxChunks` AND `maxChars`; defaults **20** / **8000**; drop whole chunks only (never split mid-chunk); DB order |
| Truncation logging | When anything is dropped: `this.log.info("chat_context_truncated", { requestId, subdomainSlug, fetched, kept, maxChunks, maxChars })` |
| Config knobs | Optional params on helpers (`RagContextLimits`); defaults in code; `handleChatPost` can pass them; **no** ServerOptions/env wiring yet |
| Empty context | Omit business-context block and extra guardrails; chat behaves as today |
| Prompt home | Format + select + guardrail text in `chatHandler.ts`; DB call only in `index.ts` |
| JSON mode | Keep existing `response_format: { type: "json_object" }` on `createChatCompletion` |
| Persist | Keep existing `updateTenantState` + `{ reply, jsonState }` response |
| Scope | Backend chat path + unit/route tests only |
| Out of scope | Embeddings, semantic top-k, web UI changes, ServerOptions/env for limits, new HTTP fields |

## Architecture

```
POST /api/chat
  → parse body / load tenant (existing)
  → contextChunks = db.getTenantContextChunks(subdomainSlug)
  → { kept, truncated } = selectContextChunks(contextChunks, limits?)
  → if truncated → log chat_context_truncated
  → if kept.length > 0 → formatBusinessContextBlock(kept)
  → systemContent = buildChatSystemPrompt(tenant, jsonState, contextBlock?)
  → createChatCompletion (json_object) → parse → updateTenantState → 200
```

### Files

| Path | Role |
| --- | --- |
| `backend-api/src/services/sutra/index.ts` | After tenant lookup: fetch chunks, select/truncate, log if truncated, pass optional context block into prompt builder |
| `backend-api/src/services/sutra/chatHandler.ts` | `RagContextLimits`, `selectContextChunks`, `formatBusinessContextBlock`, extend `buildChatSystemPrompt`; keep `createChatCompletion` JSON mode |
| `backend-api/test/services/sutra/chatHandler.test.ts` | Unit tests for select/format/prompt guardrails |
| `backend-api/test/services/sutra/chat.test.ts` | Stub `getTenantContextChunks`; assert system prompt includes document labels when chunks present |

No schema or client API contract changes.

## Prompt shape

When `kept` is non-empty, append to the system prompt:

```
# BUSINESS CONTEXT FROM UPLOADED DOCUMENTS
Use the following verified facts (prices, services, opening hours) to update the website state:
[Document: <filename>]
- <chunk content>
...
```

Chunks with the same `filename` share one `[Document: …]` header; each chunk content is a bullet under that header.

Also append a guardrail instructing the model to **strictly prioritize** facts from the uploaded context over general knowledge when modifying `jsonState` (hero/tagline, prices, service lists, hours, etc.).

Existing instructions remain: JSON-only shape `{ reply, jsonState }`, full `jsonState` (not a patch), tenant identity, current `jsonState`.

## Truncation algorithm

Defaults: `maxChunks = 20`, `maxChars = 8000`.

1. Walk chunks in the order returned by `getTenantContextChunks`.
2. Accept a chunk if `kept.length < maxChunks` and `runningChars + chunk.content.length <= maxChars`.
3. On the first chunk that does not fit, stop (do not skip ahead to later smaller chunks). Remaining chunks are dropped. If the first chunk alone exceeds `maxChars`, `kept` is empty and chat proceeds without a context block.
4. `truncated === true` iff `kept.length < chunks.length`.

`selectContextChunks(chunks, limits?: RagContextLimits)` returns `{ kept, truncated }`.

## Error handling

| Case | Behavior |
| --- | --- |
| Invalid body / missing deps / tenant missing / model failure / bad JSON | Unchanged (400 / 503 / 404 / 502) |
| `getTenantContextChunks` throws | Propagate to Express error middleware |
| Empty chunks or empty after truncation | Continue without context block (not an error) |

## Testing

- **Unit:** `selectContextChunks` under/over chunk and char caps; whole-chunk drop; `formatBusinessContextBlock` filename labels + grouping; `buildChatSystemPrompt` includes block + guardrail when provided, omits when not.
- **Route:** Existing chat tests stub `getTenantContextChunks` → `[]`. One happy-path case returns sample chunks and asserts the OpenRouter system message contains `[Document: …]` and the business-context header.

## Success criteria

1. Chat for a tenant with uploaded docs grounds the system prompt with labeled facts before OpenRouter.
2. Limits are parameter-driven defaults (20 / 8000) with truncation logged.
3. Response remains JSON `{ reply, jsonState }` and `jsonState` is persisted to PostgreSQL.
4. Tenants with no chunks keep current chat behavior.
