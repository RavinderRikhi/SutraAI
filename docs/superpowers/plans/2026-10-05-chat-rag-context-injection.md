# Chat RAG Context Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire tenant-scoped document chunk retrieval into `handleChatPost` so OpenRouter gets a source-grounded system prompt (with truncation limits), then keep existing JSON mode and `jsonState` persistence.

**Architecture:** Pure helpers in `chatHandler.ts` (`selectContextChunks`, `formatBusinessContextBlock`, extended `buildChatSystemPrompt`). Orchestration stays in `SutraServer.handleChatPost`: fetch via `getTenantContextChunks`, truncate, log if truncated, inject context when non-empty. No schema or HTTP contract changes.

**Tech Stack:** Express 5, TypeScript (CommonJS), existing OpenAI/OpenRouter client, Prisma/`DbService`, Mocha + Chai + Supertest.

## Global Constraints

- Approach 1 only: helpers in `chatHandler.ts`; DB call only in `index.ts`.
- Retrieval: `this.db.getTenantContextChunks(subdomainSlug)` — no embeddings/ranking.
- Truncation defaults: `maxChunks = 20`, `maxChars = 8000`; optional `RagContextLimits` params; no ServerOptions/env wiring yet.
- Truncation: walk DB order; stop at first chunk that does not fit; never split mid-chunk; `truncated === kept.length < chunks.length`.
- Log when truncated: `this.log.info("chat_context_truncated", { requestId, subdomainSlug, fetched, kept, maxChunks, maxChars })`.
- Empty kept → omit business-context block and guardrails (chat as today).
- Keep `response_format: { type: "json_object" }` and `updateTenantState` + `{ reply, jsonState }` response.
- No web UI, embeddings, semantic top-k, new HTTP fields, or env knobs.
- Spec: `docs/superpowers/specs/2026-10-05-chat-rag-context-injection-design.md`
- Note: `docs/superpowers/**` is gitignored by `**superpowers**` — use `git add -f` when committing under that path.
- Run tests from `backend-api/`: `npm test`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend-api/src/services/sutra/chatHandler.ts` | `RagContextLimits`, defaults, `selectContextChunks`, `formatBusinessContextBlock`, extend `buildChatSystemPrompt` |
| `backend-api/src/services/sutra/index.ts` | Fetch chunks, select/truncate, log truncation, pass context into prompt |
| `backend-api/test/services/sutra/chatHandler.test.ts` | Unit tests for select/format/prompt |
| `backend-api/test/services/sutra/chat.test.ts` | Stub `getTenantContextChunks`; assert grounded system prompt on happy path |

---

### Task 1: Context select/format + prompt guardrails (TDD)

**Files:**
- Modify: `backend-api/src/services/sutra/chatHandler.ts`
- Test: `backend-api/test/services/sutra/chatHandler.test.ts`

**Interfaces:**
- Consumes: existing `buildChatSystemPrompt` / chunk shape `{ filename: string; content: string }`
- Produces:
  - `DEFAULT_RAG_MAX_CHUNKS = 20`
  - `DEFAULT_RAG_MAX_CHARS = 8000`
  - `export type RagContextLimits = { maxChunks?: number; maxChars?: number }`
  - `export type ContextChunk = { filename: string; content: string }`
  - `selectContextChunks(chunks: ContextChunk[], limits?: RagContextLimits): { kept: ContextChunk[]; truncated: boolean }`
  - `formatBusinessContextBlock(chunks: ContextChunk[]): string`
  - `buildChatSystemPrompt(tenant, jsonState, contextBlock?: string): string` — when `contextBlock` is non-empty string, append block + guardrail

- [ ] **Step 1: Write failing unit tests**

Append to `backend-api/test/services/sutra/chatHandler.test.ts` (update imports):

```ts
import { expect } from "chai";
import type OpenAI from "openai";

import {
  CHAT_MODEL,
  DEFAULT_RAG_MAX_CHARS,
  DEFAULT_RAG_MAX_CHUNKS,
  buildChatSystemPrompt,
  createChatCompletion,
  formatBusinessContextBlock,
  parseChatModelPayload,
  parseChatRequestBody,
  selectContextChunks
} from "../../../src/services/sutra/chatHandler";

// ... keep existing tests ...

describe("selectContextChunks", () => {
  it("keeps all chunks under defaults", () => {
    const chunks = [
      { filename: "a.txt", content: "one" },
      { filename: "a.txt", content: "two" }
    ];
    expect(selectContextChunks(chunks)).to.deep.equal({
      kept: chunks,
      truncated: false
    });
  });

  it("stops at maxChunks", () => {
    const chunks = [
      { filename: "a.txt", content: "1" },
      { filename: "a.txt", content: "2" },
      { filename: "a.txt", content: "3" }
    ];
    expect(selectContextChunks(chunks, { maxChunks: 2 })).to.deep.equal({
      kept: chunks.slice(0, 2),
      truncated: true
    });
  });

  it("stops at maxChars without splitting a chunk", () => {
    const chunks = [
      { filename: "a.txt", content: "abcd" },
      { filename: "a.txt", content: "efgh" }
    ];
    expect(selectContextChunks(chunks, { maxChars: 4 })).to.deep.equal({
      kept: [chunks[0]],
      truncated: true
    });
  });

  it("returns empty kept when first chunk exceeds maxChars", () => {
    const chunks = [{ filename: "a.txt", content: "too-long" }];
    expect(selectContextChunks(chunks, { maxChars: 3 })).to.deep.equal({
      kept: [],
      truncated: true
    });
  });

  it("uses DEFAULT_RAG_MAX_CHUNKS and DEFAULT_RAG_MAX_CHARS", () => {
    expect(DEFAULT_RAG_MAX_CHUNKS).to.equal(20);
    expect(DEFAULT_RAG_MAX_CHARS).to.equal(8000);
  });
});

describe("formatBusinessContextBlock", () => {
  it("groups by filename with Document labels", () => {
    const block = formatBusinessContextBlock([
      { filename: "menu.pdf", content: "Espresso: $3.50" },
      { filename: "menu.pdf", content: "Cappuccino: $5.00" },
      { filename: "hours.txt", content: "Mon-Fri 9-5" }
    ]);
    expect(block).to.include("# BUSINESS CONTEXT FROM UPLOADED DOCUMENTS");
    expect(block).to.include(
      "Use the following verified facts (prices, services, opening hours) to update the website state:"
    );
    expect(block).to.include("[Document: menu.pdf]");
    expect(block).to.include("- Espresso: $3.50");
    expect(block).to.include("- Cappuccino: $5.00");
    expect(block).to.include("[Document: hours.txt]");
    expect(block).to.include("- Mon-Fri 9-5");
  });
});

describe("buildChatSystemPrompt with context", () => {
  it("omits business context when contextBlock is omitted or empty", () => {
    const prompt = buildChatSystemPrompt(
      { subdomainSlug: "acme", businessName: "Acme" },
      { businessName: "Acme" }
    );
    expect(prompt).to.not.include("BUSINESS CONTEXT FROM UPLOADED DOCUMENTS");
    expect(prompt).to.not.include("strictly prioritize");

    const empty = buildChatSystemPrompt(
      { subdomainSlug: "acme", businessName: "Acme" },
      { businessName: "Acme" },
      ""
    );
    expect(empty).to.not.include("BUSINESS CONTEXT FROM UPLOADED DOCUMENTS");
  });

  it("appends context block and guardrail when contextBlock is non-empty", () => {
    const block = formatBusinessContextBlock([
      { filename: "menu.pdf", content: "Espresso: $3.50" }
    ]);
    const prompt = buildChatSystemPrompt(
      { subdomainSlug: "acme", businessName: "Acme" },
      { businessName: "Acme" },
      block
    );
    expect(prompt).to.include(block);
    expect(prompt).to.include("strictly prioritize");
    expect(prompt).to.include("uploaded context");
    expect(prompt).to.include("jsonState");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api
npm test -- --grep "selectContextChunks|formatBusinessContextBlock|buildChatSystemPrompt with context"
```

Expected: FAIL (exports / signatures missing).

- [ ] **Step 3: Implement helpers in `chatHandler.ts`**

Add near the top (after existing types):

```ts
export type ContextChunk = {
  filename: string;
  content: string;
};

export type RagContextLimits = {
  maxChunks?: number;
  maxChars?: number;
};

export const DEFAULT_RAG_MAX_CHUNKS = 20;
export const DEFAULT_RAG_MAX_CHARS = 8000;

export function selectContextChunks(
  chunks: ContextChunk[],
  limits?: RagContextLimits
): { kept: ContextChunk[]; truncated: boolean } {
  const maxChunks = limits?.maxChunks ?? DEFAULT_RAG_MAX_CHUNKS;
  const maxChars = limits?.maxChars ?? DEFAULT_RAG_MAX_CHARS;
  const kept: ContextChunk[] = [];
  let runningChars = 0;
  for (const chunk of chunks) {
    if (kept.length >= maxChunks || runningChars + chunk.content.length > maxChars) {
      break;
    }
    kept.push(chunk);
    runningChars += chunk.content.length;
  }
  return { kept, truncated: kept.length < chunks.length };
}

export function formatBusinessContextBlock(chunks: ContextChunk[]): string {
  const lines = [
    "# BUSINESS CONTEXT FROM UPLOADED DOCUMENTS",
    "Use the following verified facts (prices, services, opening hours) to update the website state:"
  ];
  let currentFile: string | null = null;
  for (const chunk of chunks) {
    if (chunk.filename !== currentFile) {
      currentFile = chunk.filename;
      lines.push(`[Document: ${chunk.filename}]`);
    }
    lines.push(`- ${chunk.content}`);
  }
  return lines.join("\n");
}
```

Replace `buildChatSystemPrompt` with:

```ts
export function buildChatSystemPrompt(
  tenant: { subdomainSlug: string; businessName: string },
  jsonState: Record<string, unknown>,
  contextBlock?: string
): string {
  const parts = [
    "You are SutraAI, a website builder assistant.",
    'Respond with JSON only, shape: { "reply": string, "jsonState": object }.',
    "jsonState must be the FULL site configuration after this turn (not a patch).",
    "Include at least: businessName, tagline, accentColors { primary, secondary }, sections (array of { id, type, content }).",
    "Merge the user's request into the current jsonState; keep unchanged fields.",
    `Tenant slug: ${tenant.subdomainSlug}`,
    `Tenant business name: ${tenant.businessName}`,
    `Current jsonState: ${JSON.stringify(jsonState)}`
  ];
  if (contextBlock !== undefined && contextBlock.trim() !== "") {
    parts.push(
      contextBlock,
      "When modifying jsonState (hero taglines, prices, service lists, hours, or similar), strictly prioritize facts from the uploaded context over general knowledge."
    );
  }
  return parts.join("\n");
}
```

Leave `createChatCompletion` unchanged (already has `response_format: { type: "json_object" }`).

- [ ] **Step 4: Run unit tests to verify they pass**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api
npm test -- --grep "chatHandler utilities|selectContextChunks|formatBusinessContextBlock|buildChatSystemPrompt"
```

Expected: PASS for all matching tests.

- [ ] **Step 5: Commit**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI
git add backend-api/src/services/sutra/chatHandler.ts backend-api/test/services/sutra/chatHandler.test.ts
git commit -m "$(cat <<'EOF'
feat: add RAG context select/format helpers for chat prompts

EOF
)"
```

---

### Task 2: Wire `handleChatPost` + route tests (TDD)

**Files:**
- Modify: `backend-api/src/services/sutra/index.ts`
- Test: `backend-api/test/services/sutra/chat.test.ts`

**Interfaces:**
- Consumes: `getTenantContextChunks`, `selectContextChunks`, `formatBusinessContextBlock`, `buildChatSystemPrompt(tenant, jsonState, contextBlock?)`, `DEFAULT_RAG_MAX_CHUNKS`, `DEFAULT_RAG_MAX_CHARS`
- Produces: chat route that injects grounded context when chunks exist; truncation log when caps drop chunks

- [ ] **Step 1: Update route tests (fail until wired)**

In `backend-api/test/services/sutra/chat.test.ts`, every `db` stub that reaches past tenant lookup must include `getTenantContextChunks`. For existing tests, add:

```ts
getTenantContextChunks: async () => []
```

Add a new test (or extend the 200 happy path) that captures the OpenRouter `create` args and asserts grounded context:

```ts
it("injects tenant document context into the system prompt", async () => {
  let received: { messages?: Array<{ role: string; content: string }> } | undefined;
  const db = {
    getTenantBySlug: async () => sampleTenant,
    getTenantContextChunks: async () => [
      { filename: "menu.pdf", content: "Espresso: $3.50" }
    ],
    updateTenantState: async (_slug: string, state: unknown) => ({
      ...sampleTenant,
      jsonState: state
    })
  } as unknown as DbService;

  const modelJson = {
    reply: "Updated prices",
    jsonState: {
      businessName: "Acme",
      tagline: "Espresso $3.50",
      accentColors: { primary: "#000", secondary: "#fff" },
      sections: []
    }
  };

  const openRouter = {
    chat: {
      completions: {
        create: async (args: { messages: Array<{ role: string; content: string }> }) => {
          received = args;
          return {
            choices: [{ message: { content: JSON.stringify(modelJson) } }]
          };
        }
      }
    }
  } as unknown as OpenAI;

  const app = buildApp({ db, openRouter });
  const res = await request(app)
    .post("/api/chat")
    .send({
      subdomainSlug: "acme",
      messages: [{ role: "user", content: "Use menu prices" }],
      jsonState: { businessName: "Acme" }
    });

  expect(res.status).to.equal(200);
  const system = received?.messages?.find((m) => m.role === "system")?.content ?? "";
  expect(system).to.include("# BUSINESS CONTEXT FROM UPLOADED DOCUMENTS");
  expect(system).to.include("[Document: menu.pdf]");
  expect(system).to.include("Espresso: $3.50");
  expect(system).to.include("strictly prioritize");
});
```

Also update the existing `"returns 200 and persists jsonState on valid model response"` db stub with `getTenantContextChunks: async () => []`, and the 502 tests similarly.

- [ ] **Step 2: Run route tests to verify new case fails**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api
npm test -- --grep "injects tenant document context"
```

Expected: FAIL (system prompt lacks business context / method missing / TypeError if stub incomplete on other tests run together).

Then run full chat suite once stubs are added:

```bash
npm test -- --grep "POST /api/chat"
```

Existing cases should still pass once stubs return `[]`; the new inject test should fail until Step 3.

- [ ] **Step 3: Wire `handleChatPost` in `index.ts`**

Update imports from `./chatHandler`:

```ts
import {
  buildChatSystemPrompt,
  createChatCompletion,
  DEFAULT_RAG_MAX_CHARS,
  DEFAULT_RAG_MAX_CHUNKS,
  formatBusinessContextBlock,
  parseChatModelPayload,
  parseChatRequestBody,
  selectContextChunks
} from "./chatHandler";
```

Replace the prompt-build section inside `handleChatPost` (after tenant is found, before `createChatCompletion`) with:

```ts
const contextChunks = await this.db.getTenantContextChunks(subdomainSlug);
const { kept, truncated } = selectContextChunks(contextChunks);
if (truncated) {
  this.log.info("chat_context_truncated", {
    requestId: requestId ?? "unknown",
    subdomainSlug,
    fetched: contextChunks.length,
    kept: kept.length,
    maxChunks: DEFAULT_RAG_MAX_CHUNKS,
    maxChars: DEFAULT_RAG_MAX_CHARS
  });
}

const contextBlock =
  kept.length > 0 ? formatBusinessContextBlock(kept) : undefined;
const systemContent = buildChatSystemPrompt(tenant, jsonState, contextBlock);
```

Do not change the completion / parse / `updateTenantState` / response path.

Optional (for later plug-in): pass an explicit limits object into `selectContextChunks` from a local const — not required if defaults are used and logged via `DEFAULT_RAG_*`.

- [ ] **Step 4: Run full chat tests**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/backend-api
npm test -- --grep "POST /api/chat|chatHandler"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI
git add backend-api/src/services/sutra/index.ts backend-api/test/services/sutra/chat.test.ts
git commit -m "$(cat <<'EOF'
feat: inject tenant RAG context into chat system prompt

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| `getTenantContextChunks(subdomainSlug)` before OpenRouter | Task 2 |
| Format block with `[Document: …]` labels | Task 1 (`formatBusinessContextBlock`) |
| Guardrails: prioritize uploaded facts for jsonState | Task 1 (`buildChatSystemPrompt`) |
| Truncation 20 / 8000 + optional params | Task 1 (`selectContextChunks` / `RagContextLimits`) |
| Log `chat_context_truncated` | Task 2 |
| Empty context → no block | Task 1 + 2 |
| `response_format: json_object` | Already present; Task 1 leaves it |
| Persist `jsonState` + return payload | Already present; Task 2 leaves it |
| Unit + route tests | Task 1 + 2 |

No placeholders. Types/names consistent: `ContextChunk`, `RagContextLimits`, `selectContextChunks`, `formatBusinessContextBlock`, `DEFAULT_RAG_MAX_CHUNKS`, `DEFAULT_RAG_MAX_CHARS`.
