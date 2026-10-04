# Split-Screen Chat + Live Preview Dashboard

## Goal

Replace the current single-column chat harness in `web/src/App.tsx` with a split-screen dashboard: chat on the left, live `jsonState` preview on the right. Stay inside the existing Vite React TypeScript app under `web/src/`. Do not scaffold a new app or change the backend API contract.

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Language / files | TypeScript `.tsx` (match existing app) |
| API payload field | `jsonState` (not `clientState`) |
| API base URL | `import.meta.env.VITE_API_URL ?? "http://localhost:3000"` |
| Preview model | Map known `sections[].type` values; skip unknown types |
| State ownership | `Dashboard` owns `jsonState` |
| Debug JSON editor | Keep, hidden behind a slide-out opened by a show button |
| Subdomain slug | Editable field in chat panel header (default `"acme"`) |
| Health check | Keep; control in chat panel header |
| Contact form | Preview-only UI (no real submit) |

## Architecture

```
App.tsx
  └── Dashboard.tsx          // owns jsonState + debugOpen
        ├── ChatPanel        // left 50%: history, slug, health, input, POST /api/chat
        ├── PreviewPanel     // right 50%: maps sections[].type → modules
        └── DebugDrawer      // slide-out: JSON textarea + Apply
```

- `jsonState` is the single source of truth for the preview.
- Chat updates it from the API response; the debug drawer can overwrite it on explicit Apply.
- No React Context; props only.

## Components

### `App.tsx`

Thin shell that renders `<Dashboard />`. No harness logic remains here.

### `Dashboard.tsx`

- 50/50 split layout (CSS grid or flex).
- State: `jsonState: Record<string, unknown>` (initial `{}`), `debugOpen: boolean`.
- Toggle button for the debug drawer.
- Passes `jsonState` and `onJsonStateChange` to `ChatPanel`, `PreviewPanel`, and `DebugDrawer`.

### `ChatPanel.tsx`

Props: `jsonState`, `onJsonStateChange`.

Owns: message history, subdomain slug, input text, loading/error, health result.

On form submit:

1. Validate non-empty message and slug.
2. Append `{ role: "user", content }` to local history.
3. `POST ${apiUrl}/api/chat` with `{ subdomainSlug, messages, jsonState }`.
4. On success: append `{ role: "assistant", content: reply }`; if `body.jsonState` is an object, call `onJsonStateChange(body.jsonState)`.

Health: `GET ${apiUrl}/health`; show a compact result local to this panel. Never mutates `jsonState`.

### `PreviewPanel.tsx`

Props: `jsonState`.

- Read `sections` when it is an array.
- For each section whose `type` is one of `header` | `hero` | `services` | `contact`, render a Tailwind module from `content`.
- Prefer fields on `content`; fall back to top-level `businessName`, `tagline`, and `accentColors` when a module needs them and `content` omits them.
- Unknown types: skip.
- Empty / missing sections: simple empty-state copy.
- Defensive field access; never throw on malformed content.

### `DebugDrawer.tsx`

- Slide-in from the side when `debugOpen` is true.
- Textarea seeded from `jsonState` when opened and when parent `jsonState` changes from chat.
- **Apply** parses JSON; only calls `onJsonStateChange` when the value is a non-null object (not an array). Invalid JSON → inline error; preview unchanged.

## Data flow

1. User submits a message in `ChatPanel`.
2. Panel appends the user message, POSTs full history + current `jsonState` + slug.
3. On success: append assistant reply; lift new `jsonState` to `Dashboard` when present.
4. `PreviewPanel` re-renders from the updated object.
5. Debug Apply uses the same `onJsonStateChange` path (no chat round-trip). The next chat request automatically sends the updated state via props.
6. Health check is independent of chat and state.

## Error handling

- Empty message or slug: block submit; inline error; no API call.
- Chat HTTP / network failure: show `body.message` or a generic status/network string; leave prior messages and `jsonState` unchanged. If the user message was already appended, keep it; do not invent an assistant reply.
- Missing `reply` on HTTP 200: soft failure message; still apply `jsonState` if present.
- Debug Apply invalid JSON / non-object: inline drawer error; do not update parent state.
- Preview: skip or placeholder on bad fields; never throw.
- Disable send while a chat request is in flight.

## File plan

| Path | Action |
| --- | --- |
| `web/src/App.tsx` | Replace harness with `<Dashboard />` |
| `web/src/components/Dashboard.tsx` | Create |
| `web/src/components/ChatPanel.tsx` | Create |
| `web/src/components/PreviewPanel.tsx` | Create |
| `web/src/components/DebugDrawer.tsx` | Create |
| `web/src/components/sectionMap.ts` | Create pure filter helper + assert self-check |

No new dependencies. No backend changes. No new Vite/project scaffolding.

## Testing

- One assert-based self-check for the pure section-mapping helper: mixed `sections` types → only `header` / `hero` / `services` / `contact` kept in order; unknown types dropped.
- Manual smoke: health button, one chat turn updates preview, debug Apply updates preview, invalid Apply does not.
- Out of scope: E2E, OpenRouter mocks, visual regression, new test framework in `web`.

## Out of scope

- Public subdomain hosting / production site renderer
- Streaming chat
- Persisting chat history across reloads
- Real contact-form submission
- Changing backend prompt or `/api/chat` schema
