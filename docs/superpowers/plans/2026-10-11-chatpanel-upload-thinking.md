# ChatPanel Upload & Thinking Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add RAG document upload and a shared thinking/busy UI to the SutraAI web `ChatPanel` harness.

**Architecture:** Keep Approach 1 — all UI/handlers live in `ChatPanel.tsx`. Export a tiny pure `messagesForChatApi` helper (drops `system`) with an assert-based check beside the panel. Upload hits the existing `${apiUrl}/api/documents/upload` endpoint; one `isThinking` flag drives the typing bubble and locks input/send/upload.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Vite; assert check via `npx tsx` (same pattern as `sectionMap.check.ts`). No new npm packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-11-chatpanel-upload-thinking-design.md`
- Upload URL: `${apiUrl}/api/documents/upload` with `apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000"`
- Multipart: `subdomainSlug` + `files` (multer field name must be `files`)
- File input: `accept=".pdf,.txt"`, single file
- Success copy: `📎 Successfully uploaded ${file.name} — RAG context updated!` as a local `system` message
- Failures: `chatError` banner only — never inject upload errors into the thread
- Chat POST body `messages`: only `user` | `assistant` (via `messagesForChatApi`)
- Replace `sending` with `isThinking` for both chat and upload
- Thinking bubble is UI-only (not stored in `messages`)
- No backend changes; no new dependencies; no React Testing Library
- Note: `docs/superpowers/**` is gitignored by `**superpowers**` — use `git add -f` when committing under that path
- Web check: from `web/`, `npx tsx src/components/chatMessages.check.ts`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `web/src/components/ChatPanel.tsx` | Export `messagesForChatApi`; upload UI/handler; `isThinking`; thinking bubble; auto-scroll; composer with paperclip |
| `web/src/components/chatMessages.check.ts` | Assert `messagesForChatApi` drops `system` and preserves order of user/assistant |

---

### Task 1: `messagesForChatApi` helper + check

**Files:**
- Modify: `web/src/components/ChatPanel.tsx`
- Create: `web/src/components/chatMessages.check.ts`

**Interfaces:**
- Consumes: existing `ChatMessage` type (`role: "user" | "assistant" | "system"`)
- Produces: `export function messagesForChatApi(messages: ChatMessage[]): ChatMessage[]` — returns only `user` and `assistant`, same relative order

- [ ] **Step 1: Write the failing check**

Create `web/src/components/chatMessages.check.ts`:

```ts
import assert from "node:assert/strict";
import { messagesForChatApi, type ChatMessage } from "./ChatPanel.tsx";

const input: ChatMessage[] = [
  { role: "system", content: "📎 Successfully uploaded a.txt — RAG context updated!" },
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hello" },
  { role: "system", content: "noise" },
  { role: "user", content: "Again" }
];

const out = messagesForChatApi(input);
assert.deepEqual(out, [
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hello" },
  { role: "user", content: "Again" }
]);
assert.equal(messagesForChatApi([]).length, 0);
assert.deepEqual(
  messagesForChatApi([{ role: "system", content: "only" }]),
  []
);

console.log("chatMessages.check: ok");
```

- [ ] **Step 2: Run check to verify it fails**

Run (from `web/`):

```bash
npx tsx src/components/chatMessages.check.ts
```

Expected: FAIL — `messagesForChatApi` is not exported / not defined.

- [ ] **Step 3: Add the helper**

Near the top of `web/src/components/ChatPanel.tsx`, after the `ChatMessage` type export, add:

```ts
export function messagesForChatApi(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.role === "user" || m.role === "assistant");
}
```

- [ ] **Step 4: Run check to verify it passes**

Run (from `web/`):

```bash
npx tsx src/components/chatMessages.check.ts
```

Expected: stdout includes `chatMessages.check: ok` and exit code 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ChatPanel.tsx web/src/components/chatMessages.check.ts
git commit -m "$(cat <<'EOF'
feat: filter system messages out of chat API payloads.

EOF
)"
```

---

### Task 2: `isThinking`, thinking bubble, auto-scroll, lock controls

**Files:**
- Modify: `web/src/components/ChatPanel.tsx`

**Interfaces:**
- Consumes: `messagesForChatApi` from Task 1
- Produces: `isThinking` state (replaces `sending`); thinking bubble in feed; scroll-to-bottom on `[messages, isThinking]`; chat POST uses `messagesForChatApi(nextMessages)`

- [ ] **Step 1: Update imports and state**

In `web/src/components/ChatPanel.tsx`, change the React import and replace `sending` with `isThinking` + add refs:

```ts
import { useEffect, useRef, useState, type FormEvent } from "react";
```

Inside the component, replace:

```ts
const [sending, setSending] = useState(false);
```

with:

```ts
const [isThinking, setIsThinking] = useState(false);
const feedRef = useRef<HTMLDivElement>(null);
const fileInputRef = useRef<HTMLInputElement>(null);
```

(`fileInputRef` is used in Task 3; add it now so the feed/composer edits stay in one place.)

Add after state declarations:

```ts
useEffect(() => {
  const el = feedRef.current;
  if (el === null) {
    return;
  }
  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}, [messages, isThinking]);
```

- [ ] **Step 2: Wire chat send to `isThinking` + filtered messages**

In `sendChat`:

1. After validation, if `isThinking` is already true, `return`.
2. Replace every `setSending(...)` with `setIsThinking(...)`.
3. In the fetch body, use `messages: messagesForChatApi(nextMessages)` instead of `messages: nextMessages`.

Relevant body fragment:

```ts
body: JSON.stringify({
  subdomainSlug: slug,
  messages: messagesForChatApi(nextMessages),
  jsonState
})
```

And busy toggles:

```ts
setIsThinking(true);
// ...
} finally {
  setIsThinking(false);
}
```

Early guard at the top of `sendChat` (after `preventDefault`):

```ts
if (isThinking) {
  return;
}
```

- [ ] **Step 3: Update feed + composer markup for thinking / lock**

Replace the feed `<div className="flex-1 space-y-3 overflow-auto p-4">` block with:

```tsx
<div ref={feedRef} className="flex-1 space-y-3 overflow-auto p-4">
  {messages.length === 0 && !isThinking ? (
    <p className="text-sm text-slate-400">No messages yet.</p>
  ) : (
    messages.map((msg, i) => (
      <div
        key={`${msg.role}-${i}`}
        className={`rounded p-3 text-sm ${
          msg.role === "user"
            ? "bg-slate-800"
            : msg.role === "system"
              ? "bg-slate-900/60 text-slate-300"
              : "bg-slate-900"
        }`}
      >
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">
          {msg.role}
        </p>
        <p className="whitespace-pre-wrap">{msg.content}</p>
      </div>
    ))
  )}
  {isThinking ? (
    <div
      className="rounded bg-slate-900 p-3 text-sm"
      aria-live="polite"
      aria-label="Thinking"
    >
      <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">
        assistant
      </p>
      <div className="flex items-center gap-1 px-1 py-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
      </div>
    </div>
  ) : null}
</div>
```

In the form, replace `disabled={sending}` / `{sending ? "Sending…" : "Send"}` with `isThinking`:

```tsx
<input
  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
  value={userMessage}
  onChange={(e) => setUserMessage(e.target.value)}
  disabled={isThinking}
/>
```

```tsx
<button
  type="submit"
  disabled={isThinking}
  className="rounded bg-emerald-600 px-4 py-2 text-sm disabled:opacity-50"
>
  {isThinking ? "Sending…" : "Send"}
</button>
```

- [ ] **Step 4: Typecheck**

Run (from `web/`):

```bash
npx tsc -b --pretty false
```

Expected: exit 0, no errors.

Also re-run:

```bash
npx tsx src/components/chatMessages.check.ts
```

Expected: `chatMessages.check: ok`

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ChatPanel.tsx
git commit -m "$(cat <<'EOF'
feat: show thinking bubble and lock chat while waiting.

EOF
)"
```

---

### Task 3: Paperclip upload widget + RAG ingest handler

**Files:**
- Modify: `web/src/components/ChatPanel.tsx`

**Interfaces:**
- Consumes: `isThinking` / `setIsThinking`, `fileInputRef`, `subdomainSlug`, `setMessages`, `setChatError` from Task 2
- Produces: hidden file input + paperclip control; `uploadDocument` handler posting `FormData` to `${apiUrl}/api/documents/upload`

- [ ] **Step 1: Add `uploadDocument` handler**

Inside the component (after `sendChat`), add:

```ts
async function uploadDocument(file: File): Promise<void> {
  if (isThinking) {
    return;
  }
  setChatError("");
  const slug = subdomainSlug.trim();
  if (slug === "") {
    setChatError("Enter a subdomain slug");
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = "";
    }
    return;
  }

  setIsThinking(true);
  try {
    const formData = new FormData();
    formData.append("subdomainSlug", slug);
    formData.append("files", file);
    const response = await fetch(`${apiUrl}/api/documents/upload`, {
      method: "POST",
      body: formData
    });
    const body = (await response.json()) as { message?: string };
    if (!response.ok) {
      setChatError(body.message ?? `Upload failed (${response.status})`);
      return;
    }
    setMessages((prev) => [
      ...prev,
      {
        role: "system",
        content: `📎 Successfully uploaded ${file.name} — RAG context updated!`
      }
    ]);
  } catch (error) {
    setChatError(error instanceof Error ? error.message : "Upload failed");
  } finally {
    setIsThinking(false);
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = "";
    }
  }
}
```

- [ ] **Step 2: Wire paperclip + hidden file input into the form**

Replace the form's message label + send button section with a composer row that includes paperclip. Keep the error banner above.

```tsx
<form
  onSubmit={(e) => void sendChat(e)}
  className="space-y-2 border-t border-slate-800 p-4"
>
  {chatError ? <p className="text-sm text-red-400">{chatError}</p> : null}
  <input
    ref={fileInputRef}
    type="file"
    accept=".pdf,.txt"
    className="hidden"
    onChange={(e) => {
      const file = e.target.files?.[0];
      if (file === undefined) {
        return;
      }
      void uploadDocument(file);
    }}
  />
  <label className="block text-sm">
    Message
    <div className="mt-1 flex items-stretch gap-2">
      <input
        className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
        value={userMessage}
        onChange={(e) => setUserMessage(e.target.value)}
        disabled={isThinking}
      />
      <button
        type="button"
        disabled={isThinking}
        aria-label="Upload document"
        title="Upload PDF or TXT"
        className="rounded border border-slate-700 bg-slate-900 px-3 text-slate-200 disabled:opacity-50"
        onClick={() => fileInputRef.current?.click()}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
      <button
        type="submit"
        disabled={isThinking}
        className="rounded bg-emerald-600 px-4 py-2 text-sm disabled:opacity-50"
      >
        {isThinking ? "Sending…" : "Send"}
      </button>
    </div>
  </label>
</form>
```

- [ ] **Step 3: Typecheck + unit check**

Run (from `web/`):

```bash
npx tsc -b --pretty false
npx tsx src/components/chatMessages.check.ts
```

Expected: both exit 0; check prints `chatMessages.check: ok`.

- [ ] **Step 4: Manual smoke (with API running on the configured `apiUrl`)**

1. Open the web app; leave subdomain slug `acme` (tenant must exist).
2. Click paperclip → choose a small `.txt` with extractable text.
3. Expect: thinking bubble + locked controls → system message `📎 Successfully uploaded … — RAG context updated!`.
4. Send a chat message; expect thinking bubble again, then assistant reply. Confirm DevTools Network: chat payload `messages` has no `system` roles.
5. Clear subdomain slug → try upload → expect `chatError` "Enter a subdomain slug", no new system message.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ChatPanel.tsx
git commit -m "$(cat <<'EOF'
feat: add ChatPanel document upload for RAG ingest.

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| `${apiUrl}/api/documents/upload` | Task 3 |
| FormData `subdomainSlug` + `files` | Task 3 |
| `accept=".pdf,.txt"` + paperclip | Task 3 |
| Success `system` confirmation message | Task 3 |
| Failures via `chatError` only | Task 3 |
| Filter `system` from chat POST | Task 1 + Task 2 |
| `isThinking` replaces `sending` | Task 2 |
| Thinking bubble + lock input/send/upload | Task 2 + Task 3 |
| Auto-scroll | Task 2 |
| Assert check for filter helper | Task 1 |
| No backend / no new deps | All tasks |
