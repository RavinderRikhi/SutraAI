# ChatPanel File Upload & Thinking Bubble

## Goal

Update the SutraAI web harness `ChatPanel` so operators can ingest RAG documents from the chat UI and see clear busy feedback while chat or upload is in flight.

Builds on [2026-10-05-document-upload-pipeline-design.md](./2026-10-05-document-upload-pipeline-design.md) and [2026-10-05-chat-rag-context-injection-design.md](./2026-10-05-chat-rag-context-injection-design.md). Backend upload + RAG chat wiring already exist; this spec is frontend-only.

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Approach | All changes in `web/src/components/ChatPanel.tsx` (Approach 1) |
| Upload URL | `${apiUrl}/api/documents/upload` where `apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000"` — same base as chat |
| Multipart fields | `subdomainSlug` (text) + `files` (single selected file; multer field name must be `files`) |
| Accepted types | Hidden file input `accept=".pdf,.txt"`; single-file selection |
| Success feedback | Local `system` message in the thread: `📎 Successfully uploaded [filename] — RAG context updated!` |
| Failure feedback | Existing `chatError` banner only (not injected into the thread) |
| Model history | On `POST /api/chat`, send only messages with `role === "user" \| "assistant"` (drop `system`) |
| Busy state | Replace `sending` with single `isThinking` boolean for both chat send and upload |
| Thinking UI | Non-persisted bouncing/pulsing dots bubble while `isThinking`; not stored in `messages` |
| Input lock | Disable message input, send button, and file-upload button while `isThinking` |
| Auto-scroll | Scroll feed to bottom (smooth) when `messages` or `isThinking` changes |
| Scope | Web `ChatPanel` only |
| Out of scope | Backend/API changes, multi-file picker UX, new env vars, extracted hooks/components, React Testing Library suite |

## Architecture

```
ChatPanel
  ├── messages: ChatMessage[]   (user | assistant | system)
  ├── isThinking: boolean
  ├── chat feed
  │     ├── mapped message bubbles
  │     └── thinking bubble (if isThinking) — UI-only
  └── composer
        ├── text input
        ├── paperclip → hidden file input
        └── send
```

### Files

| Path | Role |
| --- | --- |
| `web/src/components/ChatPanel.tsx` | Upload UI + handler; `isThinking`; thinking bubble; auto-scroll; filter `system` on chat POST |

No new dependencies. Animation via existing Tailwind utilities.

## UI

### Composer

- Keep subdomain slug + health controls in the header (unchanged).
- Composer row: message input, paperclip button, send button.
- Paperclip opens a hidden `<input type="file" accept=".pdf,.txt">`.
- While `isThinking`, disable input, send, and paperclip (muted/disabled styling). Thinking bubble is the primary progress signal; no separate spinner required.

### Chat feed

- User / assistant bubbles unchanged.
- `system` bubbles slightly muted (distinct from assistant).
- While `isThinking`, render a thinking row after messages with three bouncing or pulsing dots (Tailwind `animate-bounce` / opacity — no animation library).
- Attach a `ref` to the scrollable feed; `useEffect` on `[messages, isThinking]` calls `scrollTo({ top: scrollHeight, behavior: "smooth" })`.

## Data flow

### Chat send

1. Validate non-empty message and subdomain slug (existing).
2. Append user message; clear input; set `isThinking = true`; clear `chatError`.
3. `POST ${apiUrl}/api/chat` with body:
   - `subdomainSlug`
   - `messages`: current history filtered to `user` / `assistant` only
   - `jsonState`
4. Success: append assistant `reply`; apply `jsonState` via `onJsonStateChange` when present.
5. Failure: set `chatError` from response `message` or fallback.
6. `finally`: `isThinking = false`.

### File upload

1. On file selected: require a file and non-empty trimmed `subdomainSlug`; otherwise set `chatError` and reset the file input.
2. Set `isThinking = true`; clear `chatError`.
3. Build `FormData`: `append("subdomainSlug", slug)`, `append("files", file)`.
4. `POST ${apiUrl}/api/documents/upload` without setting `Content-Type` (browser sets multipart boundary).
5. **HTTP 200:** append `{ role: "system", content: "📎 Successfully uploaded ${file.name} — RAG context updated!" }`.
6. Non-OK / network error: set `chatError` from JSON `message` when available, else a short fallback.
7. `finally`: `isThinking = false`; clear file input `value` so the same file can be re-selected.

### Guards

Handlers early-return if `isThinking` is already true. Controls are also `disabled` while busy.

## Error handling

| Case | UI |
| --- | --- |
| Empty message / empty slug on send | `chatError` (existing) |
| Empty slug / no file on upload | `chatError`; no request |
| Upload HTTP 4xx/5xx or network | `chatError`; no system message |
| Chat HTTP error / missing reply / network | `chatError` (existing) |

Upload failures never become thread messages.

## Testing

- Prefer a tiny pure helper (e.g. `messagesForChatApi`) that drops `system`, with one assert-based `*.check.ts` beside the panel (same pattern as `sectionMap.check.ts`). If the filter stays a one-line inline `.filter()` with no extract, skip the check file.
- No new React Testing Library suite.
- Manual smoke: upload `.txt` → system confirmation → send chat → thinking bubble + locked controls → reply; bad upload (empty slug or rejected type) → `chatError` only.

## Success criteria

1. Paperclip uploads a `.pdf`/`.txt` to the same API base as chat and shows a system confirmation on success.
2. Chat requests never include upload confirmation `system` messages.
3. `isThinking` covers send and upload: thinking bubble visible, input/send/upload locked, feed scrolls to show the bubble.
4. Failures surface only via `chatError`.
