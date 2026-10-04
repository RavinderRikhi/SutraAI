# Split-Screen Chat + Live Preview Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web harness with a 50/50 Dashboard: chat on the left, live `jsonState` preview on the right, plus a slide-out JSON debug drawer and health check.

**Architecture:** `Dashboard` owns `jsonState` and `debugOpen`. `ChatPanel` owns message history / slug / health and POSTs to `/api/chat`. `PreviewPanel` renders known `sections[].type` modules via a pure `filterRenderableSections` helper. `DebugDrawer` applies edited JSON only on explicit Apply. `App` mounts `Dashboard` only.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, existing `VITE_API_URL` / `localhost:3000` sutra API. No new dependencies.

## Global Constraints

- Stay inside `web/src/`; do not scaffold a new app or project.
- Use TypeScript `.tsx` / `.ts` files (not `.jsx`).
- API field name is `jsonState` (not `clientState`).
- API base URL: `import.meta.env.VITE_API_URL ?? "http://localhost:3000"`.
- Preview maps only `header` | `hero` | `services` | `contact`; skip unknown types.
- Contact form is preview-only (no real submit).
- Keep health check in the chat panel header.
- No new npm dependencies; no backend changes; no new test framework in `web`.
- Spec: `docs/superpowers/specs/2026-10-04-split-screen-dashboard-design.md`
- Note: `docs/superpowers/**` is gitignored by `**superpowers**` — use `git add -f` when committing plan/spec/related files under that path.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `web/src/components/sectionMap.ts` | Pure filter of renderable sections from `jsonState` |
| `web/src/components/sectionMap.check.ts` | Assert-based self-check for `filterRenderableSections` |
| `web/src/components/PreviewPanel.tsx` | Live Tailwind section renderer |
| `web/src/components/ChatPanel.tsx` | Message history, slug, health, chat POST |
| `web/src/components/DebugDrawer.tsx` | Slide-out JSON editor + Apply |
| `web/src/components/Dashboard.tsx` | 50/50 layout; owns `jsonState` + `debugOpen` |
| `web/src/App.tsx` | Thin shell → `<Dashboard />` |

---

### Task 1: Section map helper + self-check

**Files:**
- Create: `web/src/components/sectionMap.ts`
- Create: `web/src/components/sectionMap.check.ts`
- Test: `web/src/components/sectionMap.check.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type SectionType = "header" | "hero" | "services" | "contact"`
  - `export type RenderableSection = { id: string; type: SectionType; content: Record<string, unknown> }`
  - `export function filterRenderableSections(jsonState: Record<string, unknown>): RenderableSection[]`

- [ ] **Step 1: Write the failing self-check**

Create `web/src/components/sectionMap.check.ts`:

```ts
import assert from "node:assert/strict";
import { filterRenderableSections } from "./sectionMap.ts";

const filtered = filterRenderableSections({
  sections: [
    { id: "h1", type: "header", content: { title: "Acme" } },
    { id: "x", type: "footer", content: { text: "nope" } },
    { id: "hero1", type: "hero", content: { headline: "Hi" } },
    { id: "svc", type: "services", content: { items: [] } },
    { id: "c", type: "contact", content: { email: "a@b.c" } },
    "not-an-object",
    { id: "bad", type: "hero" }
  ]
});

assert.deepEqual(
  filtered.map((s) => s.type),
  ["header", "hero", "services", "contact"]
);
assert.equal(filtered[0]?.content.title, "Acme");
assert.deepEqual(filtered[3]?.content, { email: "a@b.c" });
assert.equal(filterRenderableSections({}).length, 0);
assert.equal(filterRenderableSections({ sections: null }).length, 0);

console.log("sectionMap.check: ok");
```

- [ ] **Step 2: Run check to verify it fails**

Run:

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/web && node --experimental-strip-types src/components/sectionMap.check.ts
```

Expected: FAIL with module-not-found / cannot find `./sectionMap.ts` (or similar).

- [ ] **Step 3: Write minimal implementation**

Create `web/src/components/sectionMap.ts`:

```ts
export type SectionType = "header" | "hero" | "services" | "contact";

export type RenderableSection = {
  id: string;
  type: SectionType;
  content: Record<string, unknown>;
};

const RENDERABLE = new Set<string>(["header", "hero", "services", "contact"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function filterRenderableSections(
  jsonState: Record<string, unknown>
): RenderableSection[] {
  const sections = jsonState.sections;
  if (!Array.isArray(sections)) {
    return [];
  }
  const out: RenderableSection[] = [];
  for (const item of sections) {
    if (!isRecord(item)) {
      continue;
    }
    const type = item.type;
    if (typeof type !== "string" || !RENDERABLE.has(type)) {
      continue;
    }
    const id =
      typeof item.id === "string" && item.id !== ""
        ? item.id
        : `${type}-${out.length}`;
    const content = isRecord(item.content) ? item.content : {};
    out.push({ id, type: type as SectionType, content });
  }
  return out;
}
```

- [ ] **Step 4: Run check to verify it passes**

Run:

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/web && node --experimental-strip-types src/components/sectionMap.check.ts
```

Expected: stdout includes `sectionMap.check: ok` and exit code 0.

- [ ] **Step 5: Commit**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI
git add web/src/components/sectionMap.ts web/src/components/sectionMap.check.ts
git commit -m "$(cat <<'EOF'
Add section map helper for live preview filtering.

EOF
)"
```

---

### Task 2: PreviewPanel

**Files:**
- Create: `web/src/components/PreviewPanel.tsx`
- Modify: none yet (wired in Task 5)

**Interfaces:**
- Consumes: `filterRenderableSections` from `./sectionMap`
- Produces: `export default function PreviewPanel(props: { jsonState: Record<string, unknown> }): JSX.Element`

- [ ] **Step 1: Implement PreviewPanel**

Create `web/src/components/PreviewPanel.tsx`:

```tsx
import { filterRenderableSections, type RenderableSection } from "./sectionMap";

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function accent(jsonState: Record<string, unknown>): {
  primary: string;
  secondary: string;
} {
  const colors = jsonState.accentColors;
  if (typeof colors === "object" && colors !== null && !Array.isArray(colors)) {
    const c = colors as Record<string, unknown>;
    return {
      primary: str(c.primary, "#0ea5e9"),
      secondary: str(c.secondary, "#334155")
    };
  }
  return { primary: "#0ea5e9", secondary: "#334155" };
}

function HeaderSection({
  section,
  jsonState
}: {
  section: RenderableSection;
  jsonState: Record<string, unknown>;
}) {
  const title =
    str(section.content.title) ||
    str(section.content.businessName) ||
    str(jsonState.businessName, "Site");
  const nav = Array.isArray(section.content.links)
    ? section.content.links.filter((l): l is string => typeof l === "string")
    : [];
  return (
    <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
      <p className="text-lg font-semibold text-slate-900">{title}</p>
      {nav.length > 0 ? (
        <nav className="flex gap-4 text-sm text-slate-600">
          {nav.map((link) => (
            <span key={link}>{link}</span>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

function HeroSection({
  section,
  jsonState,
  primary
}: {
  section: RenderableSection;
  jsonState: Record<string, unknown>;
  primary: string;
}) {
  const headline =
    str(section.content.headline) ||
    str(section.content.title) ||
    str(jsonState.businessName, "Welcome");
  const tagline =
    str(section.content.tagline) ||
    str(section.content.subtitle) ||
    str(jsonState.tagline, "");
  return (
    <section className="px-6 py-16" style={{ backgroundColor: `${primary}14` }}>
      <h1 className="text-4xl font-bold text-slate-900">{headline}</h1>
      {tagline ? <p className="mt-3 max-w-xl text-lg text-slate-600">{tagline}</p> : null}
    </section>
  );
}

function ServicesSection({ section }: { section: RenderableSection }) {
  const heading = str(section.content.heading, "Services");
  const raw = section.content.items;
  const items = Array.isArray(raw)
    ? raw
        .map((item) => {
          if (typeof item === "string") {
            return { title: item, description: "" };
          }
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            const rec = item as Record<string, unknown>;
            return {
              title: str(rec.title, "Service"),
              description: str(rec.description)
            };
          }
          return null;
        })
        .filter((x): x is { title: string; description: string } => x !== null)
    : [];
  return (
    <section className="px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">{heading}</h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {items.map((item, i) => (
          <li key={`${item.title}-${i}`} className="rounded border border-slate-200 p-4">
            <p className="font-medium text-slate-900">{item.title}</p>
            {item.description ? (
              <p className="mt-1 text-sm text-slate-600">{item.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContactSection({ section }: { section: RenderableSection }) {
  const heading = str(section.content.heading, "Contact");
  const email = str(section.content.email);
  return (
    <section className="px-6 py-12 bg-slate-50">
      <h2 className="text-2xl font-semibold text-slate-900">{heading}</h2>
      {email ? <p className="mt-2 text-sm text-slate-600">{email}</p> : null}
      <form
        className="mt-6 max-w-md space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <label className="block text-sm text-slate-700">
          Name
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            name="name"
            type="text"
          />
        </label>
        <label className="block text-sm text-slate-700">
          Message
          <textarea
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            name="message"
            rows={3}
          />
        </label>
        <button
          type="submit"
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Send
        </button>
      </form>
    </section>
  );
}

export default function PreviewPanel({
  jsonState
}: {
  jsonState: Record<string, unknown>;
}) {
  const sections = filterRenderableSections(jsonState);
  const { primary } = accent(jsonState);

  if (sections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-slate-500 text-sm p-8">
        No previewable sections yet. Chat to build the site, or Apply JSON in the debug drawer.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-white text-slate-900">
      {sections.map((section) => {
        switch (section.type) {
          case "header":
            return (
              <HeaderSection key={section.id} section={section} jsonState={jsonState} />
            );
          case "hero":
            return (
              <HeroSection
                key={section.id}
                section={section}
                jsonState={jsonState}
                primary={primary}
              />
            );
          case "services":
            return <ServicesSection key={section.id} section={section} />;
          case "contact":
            return <ContactSection key={section.id} section={section} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck PreviewPanel in isolation**

Run:

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/web && npx tsc -b --pretty false 2>&1 | head -40
```

Expected: may fail on missing Dashboard/App wiring later — if errors mention only unused files that is fine; fix any type errors inside `PreviewPanel.tsx` / `sectionMap.ts` before continuing. Prefer:

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/web && npx tsc --noEmit --pretty false src/components/PreviewPanel.tsx src/components/sectionMap.ts 2>&1 | head -40
```

If project references block single-file checks, skip and rely on full `tsc -b` in Task 5.

- [ ] **Step 3: Re-run sectionMap check (regression)**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/web && node --experimental-strip-types src/components/sectionMap.check.ts
```

Expected: `sectionMap.check: ok`

- [ ] **Step 4: Commit**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI
git add web/src/components/PreviewPanel.tsx
git commit -m "$(cat <<'EOF'
Add PreviewPanel for jsonState Tailwind sections.

EOF
)"
```

---

### Task 3: ChatPanel

**Files:**
- Create: `web/src/components/ChatPanel.tsx`

**Interfaces:**
- Consumes: parent `jsonState` and `onJsonStateChange`
- Produces:
  - `export type ChatMessage = { role: "user" | "assistant" | "system"; content: string }`
  - `export default function ChatPanel(props: { jsonState: Record<string, unknown>; onJsonStateChange: (next: Record<string, unknown>) => void }): JSX.Element`

- [ ] **Step 1: Implement ChatPanel**

Create `web/src/components/ChatPanel.tsx`:

```tsx
import { useState, type FormEvent } from "react";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function ChatPanel({
  jsonState,
  onJsonStateChange
}: {
  jsonState: Record<string, unknown>;
  onJsonStateChange: (next: Record<string, unknown>) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [subdomainSlug, setSubdomainSlug] = useState("acme");
  const [userMessage, setUserMessage] = useState("");
  const [chatError, setChatError] = useState("");
  const [sending, setSending] = useState(false);
  const [healthResult, setHealthResult] = useState("");

  async function checkHealth() {
    try {
      const response = await fetch(`${apiUrl}/health`);
      const body: unknown = await response.json();
      setHealthResult(JSON.stringify(body, null, 2));
    } catch (error) {
      setHealthResult(error instanceof Error ? error.message : "Request failed");
    }
  }

  async function sendChat(event: FormEvent) {
    event.preventDefault();
    setChatError("");
    const content = userMessage.trim();
    const slug = subdomainSlug.trim();
    if (content === "") {
      setChatError("Enter a message");
      return;
    }
    if (slug === "") {
      setChatError("Enter a subdomain slug");
      return;
    }
    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content }
    ];
    setMessages(nextMessages);
    setUserMessage("");
    setSending(true);
    try {
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomainSlug: slug,
          messages: nextMessages,
          jsonState
        })
      });
      const body = (await response.json()) as {
        message?: string;
        reply?: string;
        jsonState?: Record<string, unknown>;
      };
      if (!response.ok) {
        setChatError(body.message ?? `Request failed (${response.status})`);
        return;
      }
      const reply = typeof body.reply === "string" ? body.reply.trim() : "";
      if (reply === "") {
        setChatError("Response missing reply");
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      }
      if (isRecord(body.jsonState)) {
        onJsonStateChange(body.jsonState);
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Request failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-50">
      <div className="space-y-2 border-b border-slate-800 p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">SutraAI</h1>
          <button
            type="button"
            className="rounded bg-sky-600 px-3 py-1.5 text-sm"
            onClick={() => {
              void checkHealth();
            }}
          >
            Check API health
          </button>
        </div>
        <label className="block text-sm">
          Subdomain slug
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
            value={subdomainSlug}
            onChange={(e) => setSubdomainSlug(e.target.value)}
          />
        </label>
        {healthResult ? (
          <pre className="max-h-24 overflow-auto rounded bg-slate-900 p-2 text-xs">
            {healthResult}
          </pre>
        ) : null}
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">No messages yet.</p>
        ) : (
          messages.map((msg, i) => (
            <div
              key={`${msg.role}-${i}`}
              className={`rounded p-3 text-sm ${
                msg.role === "user" ? "bg-slate-800" : "bg-slate-900"
              }`}
            >
              <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">
                {msg.role}
              </p>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={(e) => void sendChat(e)} className="space-y-2 border-t border-slate-800 p-4">
        {chatError ? <p className="text-sm text-red-400">{chatError}</p> : null}
        <label className="block text-sm">
          Message
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            disabled={sending}
          />
        </label>
        <button
          type="submit"
          disabled={sending}
          className="rounded bg-emerald-600 px-4 py-2 text-sm disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Sanity-check module parses**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/web && node --experimental-strip-types --check src/components/ChatPanel.tsx 2>&1 || true
```

React TSX may not parse under node `--check`; if so, skip — Task 5 `tsc -b` is the gate.

- [ ] **Step 3: Commit**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI
git add web/src/components/ChatPanel.tsx
git commit -m "$(cat <<'EOF'
Add ChatPanel with history, health check, and chat POST.

EOF
)"
```

---

### Task 4: DebugDrawer

**Files:**
- Create: `web/src/components/DebugDrawer.tsx`

**Interfaces:**
- Consumes: `jsonState`, `onJsonStateChange`, `open`, `onClose`
- Produces: `export default function DebugDrawer(props: { open: boolean; jsonState: Record<string, unknown>; onJsonStateChange: (next: Record<string, unknown>) => void; onClose: () => void }): JSX.Element`

- [ ] **Step 1: Implement DebugDrawer**

Create `web/src/components/DebugDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function DebugDrawer({
  open,
  jsonState,
  onJsonStateChange,
  onClose
}: {
  open: boolean;
  jsonState: Record<string, unknown>;
  onJsonStateChange: (next: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("{}");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setText(JSON.stringify(jsonState, null, 2));
      setError("");
    }
  }, [open, jsonState]);

  function apply() {
    setError("");
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) {
        setError("jsonState must be a JSON object");
        return;
      }
      onJsonStateChange(parsed);
    } catch {
      setError("Invalid JSON");
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-slate-700 bg-slate-950 text-slate-50 shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <h2 className="text-sm font-medium">Debug: site state (JSON)</h2>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-800"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <textarea
            className="min-h-0 flex-1 w-full rounded border border-slate-700 bg-slate-900 p-3 font-mono text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="button"
            className="rounded bg-amber-600 px-4 py-2 text-sm"
            onClick={apply}
          >
            Apply
          </button>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI
git add web/src/components/DebugDrawer.tsx
git commit -m "$(cat <<'EOF'
Add slide-out DebugDrawer for jsonState editing.

EOF
)"
```

---

### Task 5: Dashboard + App integration

**Files:**
- Create: `web/src/components/Dashboard.tsx`
- Modify: `web/src/App.tsx` (replace entire harness)

**Interfaces:**
- Consumes: `ChatPanel`, `PreviewPanel`, `DebugDrawer`
- Produces: `export default function Dashboard(): JSX.Element`; `App` renders `<Dashboard />`

- [ ] **Step 1: Implement Dashboard**

Create `web/src/components/Dashboard.tsx`:

```tsx
import { useState } from "react";
import ChatPanel from "./ChatPanel";
import PreviewPanel from "./PreviewPanel";
import DebugDrawer from "./DebugDrawer";

export default function Dashboard() {
  const [jsonState, setJsonState] = useState<Record<string, unknown>>({});
  const [debugOpen, setDebugOpen] = useState(false);

  return (
    <div className="relative h-screen overflow-hidden bg-slate-900">
      <button
        type="button"
        className="absolute top-3 right-3 z-30 rounded bg-slate-700 px-3 py-1.5 text-sm text-white"
        onClick={() => setDebugOpen(true)}
      >
        Show JSON
      </button>
      <div className="grid h-full grid-cols-1 md:grid-cols-2">
        <ChatPanel jsonState={jsonState} onJsonStateChange={setJsonState} />
        <div className="min-h-0 border-l border-slate-800">
          <PreviewPanel jsonState={jsonState} />
        </div>
      </div>
      <DebugDrawer
        open={debugOpen}
        jsonState={jsonState}
        onJsonStateChange={setJsonState}
        onClose={() => setDebugOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Replace App.tsx**

Replace `web/src/App.tsx` entirely with:

```tsx
import Dashboard from "./components/Dashboard";

export default function App() {
  return <Dashboard />;
}
```

- [ ] **Step 3: Typecheck and build**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/web && npm run build
```

Expected: `tsc -b` and `vite build` succeed (exit 0).

- [ ] **Step 4: Re-run sectionMap check**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/web && node --experimental-strip-types src/components/sectionMap.check.ts
```

Expected: `sectionMap.check: ok`

- [ ] **Step 5: Commit**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI
git add web/src/components/Dashboard.tsx web/src/App.tsx
git commit -m "$(cat <<'EOF'
Wire Dashboard split-screen into App.

EOF
)"
```

---

### Task 6: Manual smoke verification

**Files:**
- None (manual)

**Interfaces:**
- Consumes: running sutra API on port 3000 (or `VITE_API_URL`) and `npm run dev` for web

- [ ] **Step 1: Start web dev server (if not already running)**

```bash
cd /home/ravinder-rikhi/Workspace/projects/SutraAI/web && npm run dev
```

Expected: Vite serves on `http://localhost:5173` (or printed port).

- [ ] **Step 2: Manual checklist**

Against a running sutra API and a known tenant slug (default `acme`):

1. Click **Check API health** → JSON/status appears in chat header.
2. Send a chat message that should create sections → assistant reply appears; preview shows matching modules when `jsonState.sections` includes known types.
3. Click **Show JSON** → drawer slides in; edit a string field; **Apply** → preview updates.
4. Break the JSON (e.g. trailing comma) → **Apply** shows error; preview unchanged.
5. Confirm contact **Send** does not navigate away (preview-only `preventDefault`).

- [ ] **Step 3: No code commit unless fixes were needed**

If smoke finds bugs, fix in the owning component file, re-run `npm run build` + `sectionMap.check`, then commit with a focused message (e.g. `fix: guard PreviewPanel services items`).

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
| --- | --- |
| `.tsx`, `jsonState`, `VITE_API_URL` / `:3000` | Global + Tasks 3–5 |
| Dashboard owns `jsonState` + 50/50 split | Task 5 |
| ChatPanel history + POST + lift `jsonState` | Task 3 |
| Preview maps known section types only | Tasks 1–2 |
| Debug slide-out + Apply | Task 4 |
| Health check in chat header | Task 3 |
| App mounts Dashboard | Task 5 |
| sectionMap self-check | Task 1 |
| Manual smoke | Task 6 |
| No new deps / no backend changes | Global |

No placeholders remain after self-review. Type names are consistent: `ChatMessage`, `RenderableSection`, `SectionType`, `onJsonStateChange`, `filterRenderableSections`.
