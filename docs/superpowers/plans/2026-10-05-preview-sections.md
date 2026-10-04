# Preview Panel Contact / FAQ / Gallery / Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Whitelist and render `contact` (expanded), `faq`, `gallery`, and `footer` sections in the React preview from partial LLM `jsonState`, and teach the chat system prompt those types/shapes.

**Architecture:** Keep Approach 1 — extend `sectionMap.ts` whitelist, expand section components inside `PreviewPanel.tsx` with local defensive normalizers (`str`, link/faq/image helpers), and append a compact type/schema paragraph to `buildChatSystemPrompt`. No new dependencies or file splits.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Vite (web); Express/TS backend with Mocha + Chai for prompt tests; existing `sectionMap.check.ts` assert script (run via `npx tsx`).

## Global Constraints

- Approach 1 only: components stay in `PreviewPanel.tsx`; no `preview/sections/*` split; no shared `sectionContent.ts` module.
- No new npm packages.
- Footer/social: prefer `{ label, href }` / `{ platform, url }`; also accept plain strings and keys `links`|`navLinks`|`navigation`, `social`|`socialLinks`.
- FAQ: first item open by default; multi-open independent toggles afterward.
- Contact: `content` first, then `jsonState.phone` / `contactEmail`|`email` / `address`; heading = `content.heading` else `"Contact"`; form preview-only (`preventDefault`); accent with `primary`.
- Backend: short prompt addition + `chatHandler.test.ts` assertions only.
- Spec: `docs/superpowers/specs/2026-10-05-preview-sections-design.md`
- Note: `docs/superpowers/**` is gitignored by `**superpowers**` — use `git add -f` when committing under that path.
- Web check: from `web/`, `npx tsx src/components/sectionMap.check.ts`
- Backend tests: from `backend-api/`, `npm test`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `web/src/components/sectionMap.ts` | Add `faq`, `gallery`, `footer` to `SectionType` + `RENDERABLE` |
| `web/src/components/sectionMap.check.ts` | Assert new types pass filter; stop treating `footer` as dropped |
| `web/src/components/PreviewPanel.tsx` | Helpers + expanded contact + faq/gallery/footer components + switch cases |
| `backend-api/src/services/sutra/chatHandler.ts` | Prompt paragraph listing section types and content keys |
| `backend-api/test/services/sutra/chatHandler.test.ts` | Assert prompt mentions new types + `question` |

---

### Task 1: Whitelist faq / gallery / footer in sectionMap

**Files:**
- Modify: `web/src/components/sectionMap.ts`
- Modify: `web/src/components/sectionMap.check.ts`

**Interfaces:**
- Consumes: existing `filterRenderableSections(jsonState: Record<string, unknown>): RenderableSection[]`
- Produces: `SectionType` includes `"faq" | "gallery" | "footer"`; those types survive filtering

- [ ] **Step 1: Update the check to expect the new types (failing)**

Replace the body of `web/src/components/sectionMap.check.ts` with:

```ts
import assert from "node:assert/strict";
import { filterRenderableSections } from "./sectionMap.ts";

const filtered = filterRenderableSections({
  sections: [
    { id: "h1", type: "header", content: { title: "Acme" } },
    { id: "f1", type: "footer", content: { copyright: "© Acme" } },
    { id: "hero1", type: "hero", content: { headline: "Hi" } },
    { id: "svc", type: "services", content: { items: [] } },
    { id: "c", type: "contact", content: { email: "a@b.c" } },
    { id: "faq1", type: "faq", content: { items: [] } },
    { id: "gal1", type: "gallery", content: { images: [] } },
    "not-an-object",
    { id: "bad", type: "hero" },
    { id: "unknown", type: "pricing", content: {} }
  ]
});

assert.deepEqual(
  filtered.map((s) => s.type),
  ["header", "footer", "hero", "services", "contact", "faq", "gallery", "hero"]
);
assert.equal(filtered[0]?.content.title, "Acme");
assert.deepEqual(filtered[1]?.content, { copyright: "© Acme" });
assert.deepEqual(filtered[4]?.content, { email: "a@b.c" });
assert.deepEqual(filtered[7]?.content, {});
assert.equal(filtered[7]?.id, "bad");
assert.equal(filterRenderableSections({}).length, 0);
assert.equal(filterRenderableSections({ sections: null }).length, 0);

console.log("sectionMap.check: ok");
```

- [ ] **Step 2: Run check to verify it fails**

Run (from `web/`):

```bash
npx tsx src/components/sectionMap.check.ts
```

Expected: FAIL — assertion on filtered types (footer/faq/gallery currently dropped or order mismatch).

- [ ] **Step 3: Extend whitelist**

Replace `web/src/components/sectionMap.ts` with:

```ts
export type SectionType =
  | "header"
  | "hero"
  | "services"
  | "contact"
  | "faq"
  | "gallery"
  | "footer";

export type RenderableSection = {
  id: string;
  type: SectionType;
  content: Record<string, unknown>;
};

const RENDERABLE = new Set<string>([
  "header",
  "hero",
  "services",
  "contact",
  "faq",
  "gallery",
  "footer"
]);

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

```bash
npx tsx src/components/sectionMap.check.ts
```

Expected: `sectionMap.check: ok`

- [ ] **Step 5: Commit**

```bash
git add web/src/components/sectionMap.ts web/src/components/sectionMap.check.ts
git commit -m "feat(web): whitelist faq, gallery, and footer section types"
```

---

### Task 2: Teach chat prompt the new section types

**Files:**
- Modify: `backend-api/src/services/sutra/chatHandler.ts`
- Modify: `backend-api/test/services/sutra/chatHandler.test.ts`

**Interfaces:**
- Consumes: existing `buildChatSystemPrompt(tenant, jsonState, contextBlock?: string): string`
- Produces: same signature; prompt body includes type list + content field hints including `question`

- [ ] **Step 1: Write failing test**

In `backend-api/test/services/sutra/chatHandler.test.ts`, after the existing `"buildChatSystemPrompt includes tenant slug and jsonState"` test, add:

```ts
  it("buildChatSystemPrompt lists faq gallery footer section shapes", () => {
    const prompt = buildChatSystemPrompt(
      { subdomainSlug: "acme", businessName: "Acme" },
      { businessName: "Acme" }
    );
    expect(prompt).to.include("faq");
    expect(prompt).to.include("gallery");
    expect(prompt).to.include("footer");
    expect(prompt).to.include("question");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend-api/`):

```bash
npm test -- --grep "lists faq gallery footer"
```

Expected: FAIL — prompt does not include `faq` / `gallery` / `footer` / `question` in a section-schema sense (or assertion fails).

- [ ] **Step 3: Append prompt paragraph**

In `backend-api/src/services/sutra/chatHandler.ts`, inside `buildChatSystemPrompt`, after the line that mentions `sections (array of { id, type, content })`, insert one more string in the `parts` array:

```ts
    "Include at least: businessName, tagline, accentColors { primary, secondary }, sections (array of { id, type, content }).",
    "Section types: header, hero, services, contact, faq, gallery, footer. Typical content: contact { phone, email, address }; faq { items: [{ question, answer }] }; gallery { images: [{ url, caption }] }; footer { navLinks or links, socialLinks or social, copyright } — nav/social entries may be strings or { label, href }.",
    "Merge the user's request into the current jsonState; keep unchanged fields.",
```

(Keep surrounding lines unchanged; only insert the middle string.)

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --grep "lists faq gallery footer"
```

Expected: PASS

Also run full suite:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend-api/src/services/sutra/chatHandler.ts backend-api/test/services/sutra/chatHandler.test.ts
git commit -m "feat(chat): document faq gallery footer section shapes in system prompt"
```

---

### Task 3: Defensive helpers + expanded ContactSection

**Files:**
- Modify: `web/src/components/PreviewPanel.tsx`

**Interfaces:**
- Consumes: `RenderableSection`, `str`, `accent`, `jsonState.accentColors.primary`
- Produces (local, same file):
  - `normalizeLinks(raw: unknown): { label: string; href: string }[]`
  - `normalizeFaqItems(raw: unknown): { question: string; answer: string }[]`
  - `normalizeImages(raw: unknown): { url: string; caption: string }[]`
  - `ContactSection` props: `{ section, jsonState, primary }`

- [ ] **Step 1: Add helpers after `accent()`**

Insert after the `accent` function (before `HeaderSection`):

```tsx
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLinks(raw: unknown): { label: string; href: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: { label: string; href: string }[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item !== "") {
      out.push({ label: item, href: "#" });
      continue;
    }
    if (!isRecord(item)) {
      continue;
    }
    const href = str(item.href) || str(item.url) || "#";
    const label = str(item.label) || str(item.platform) || str(item.name);
    if (label === "") {
      continue;
    }
    out.push({ label, href });
  }
  return out;
}

function normalizeFaqItems(
  raw: unknown
): { question: string; answer: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: { question: string; answer: string }[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    out.push({
      question: str(item.question, "Question"),
      answer: str(item.answer)
    });
  }
  return out;
}

function normalizeImages(raw: unknown): { url: string; caption: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: { url: string; caption: string }[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const url = str(item.url);
    if (url === "") {
      continue;
    }
    out.push({ url, caption: str(item.caption) });
  }
  return out;
}

function firstString(...values: unknown[]): string {
  for (const v of values) {
    const s = str(v);
    if (s !== "") {
      return s;
    }
  }
  return "";
}
```

- [ ] **Step 2: Replace ContactSection**

Replace the existing `ContactSection` function with:

```tsx
function ContactSection({
  section,
  jsonState,
  primary
}: {
  section: RenderableSection;
  jsonState: Record<string, unknown>;
  primary: string;
}) {
  const heading = str(section.content.heading, "Contact");
  const phone = firstString(section.content.phone, jsonState.phone);
  const email = firstString(
    section.content.email,
    jsonState.contactEmail,
    jsonState.email
  );
  const address = firstString(section.content.address, jsonState.address);
  return (
    <section className="px-6 py-12 bg-slate-50">
      <h2 className="text-2xl font-semibold text-slate-900">{heading}</h2>
      <div className="mt-3 space-y-1 text-sm text-slate-600">
        {phone ? (
          <p>
            <a href={`tel:${phone}`} className="hover:underline">
              {phone}
            </a>
          </p>
        ) : null}
        {email ? (
          <p>
            <a href={`mailto:${email}`} className="hover:underline">
              {email}
            </a>
          </p>
        ) : null}
        {address ? <p>{address}</p> : null}
      </div>
      <form
        className="mt-6 max-w-md space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <label className="block text-sm text-slate-700">
          Name
          <input
            className="mt-1 w-full rounded border px-3 py-2 outline-none focus:ring-2"
            style={{ borderColor: "#cbd5e1", ["--tw-ring-color" as string]: primary }}
            name="name"
            type="text"
          />
        </label>
        <label className="block text-sm text-slate-700">
          Email
          <input
            className="mt-1 w-full rounded border px-3 py-2 outline-none focus:ring-2"
            style={{ borderColor: "#cbd5e1", ["--tw-ring-color" as string]: primary }}
            name="email"
            type="email"
          />
        </label>
        <label className="block text-sm text-slate-700">
          Message
          <textarea
            className="mt-1 w-full rounded border px-3 py-2 outline-none focus:ring-2"
            style={{ borderColor: "#cbd5e1", ["--tw-ring-color" as string]: primary }}
            name="message"
            rows={3}
          />
        </label>
        <button
          type="submit"
          className="rounded px-4 py-2 text-sm text-white"
          style={{ backgroundColor: primary }}
        >
          Send
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 3: Wire ContactSection props in the switch**

Keep `const { primary } = accent(jsonState)` until Task 6. Change only the contact case:

```tsx
          case "contact":
            return (
              <ContactSection
                key={section.id}
                section={section}
                jsonState={jsonState}
                primary={primary}
              />
            );
```

- [ ] **Step 4: Typecheck**

Run (from `web/`):

```bash
npm run build
```

Expected: build succeeds (tsc + vite).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PreviewPanel.tsx
git commit -m "feat(web): expand contact section with accents and jsonState fallbacks"
```

---

### Task 4: FaqSection accordion

**Files:**
- Modify: `web/src/components/PreviewPanel.tsx`

**Interfaces:**
- Consumes: `normalizeFaqItems`, `RenderableSection`
- Produces: `FaqSection` with first item open; independent toggles

- [ ] **Step 1: Add React import**

At top of `PreviewPanel.tsx`:

```tsx
import { useState } from "react";
import { filterRenderableSections, type RenderableSection } from "./sectionMap";
```

- [ ] **Step 2: Add FaqSection before the default export**

```tsx
function FaqSection({ section }: { section: RenderableSection }) {
  const heading = str(section.content.heading, "FAQ");
  const items = normalizeFaqItems(section.content.items);
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(items.length > 0 ? [0] : [])
  );

  function toggle(i: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });
  }

  return (
    <section className="px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">{heading}</h2>
      {items.length > 0 ? (
        <ul className="mt-6 divide-y divide-slate-200 border border-slate-200 rounded">
          {items.map((item, i) => {
            const expanded = open.has(i);
            return (
              <li key={`${item.question}-${i}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-900"
                  aria-expanded={expanded}
                  onClick={() => toggle(i)}
                >
                  <span>{item.question}</span>
                  <span className="ml-4 text-slate-400">{expanded ? "−" : "+"}</span>
                </button>
                {expanded ? (
                  <div className="px-4 pb-3 text-sm text-slate-600">{item.answer}</div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 3: Add switch case**

```tsx
          case "faq":
            return <FaqSection key={section.id} section={section} />;
```

- [ ] **Step 4: Typecheck**

```bash
npm run build
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PreviewPanel.tsx
git commit -m "feat(web): render faq accordion section in preview"
```

---

### Task 5: GallerySection image grid

**Files:**
- Modify: `web/src/components/PreviewPanel.tsx`

**Interfaces:**
- Consumes: `normalizeImages`
- Produces: `GallerySection` grid; skips invalid urls

- [ ] **Step 1: Add GallerySection**

```tsx
function GallerySection({ section }: { section: RenderableSection }) {
  const heading = str(section.content.heading, "Gallery");
  const images = normalizeImages(section.content.images);
  return (
    <section className="px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">{heading}</h2>
      {images.length > 0 ? (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {images.map((img, i) => (
            <li key={`${img.url}-${i}`} className="overflow-hidden rounded border border-slate-200">
              <img
                src={img.url}
                alt={img.caption || "Image"}
                className="h-40 w-full object-cover"
              />
              {img.caption ? (
                <p className="px-3 py-2 text-sm text-slate-600">{img.caption}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 2: Add switch case**

```tsx
          case "gallery":
            return <GallerySection key={section.id} section={section} />;
```

- [ ] **Step 3: Typecheck**

```bash
npm run build
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/PreviewPanel.tsx
git commit -m "feat(web): render gallery image grid section in preview"
```

---

### Task 6: FooterSection + final wiring

**Files:**
- Modify: `web/src/components/PreviewPanel.tsx`

**Interfaces:**
- Consumes: `normalizeLinks`, `primary`, `secondary`, `jsonState.businessName`
- Produces: `FooterSection`; switch complete for all new types

- [ ] **Step 1: Add FooterSection**

```tsx
function FooterSection({
  section,
  jsonState,
  primary,
  secondary
}: {
  section: RenderableSection;
  jsonState: Record<string, unknown>;
  primary: string;
  secondary: string;
}) {
  const nav = normalizeLinks(
    section.content.navLinks ??
      section.content.links ??
      section.content.navigation
  );
  const social = normalizeLinks(
    section.content.socialLinks ?? section.content.social
  );
  const copyright =
    firstString(section.content.copyright, section.content.text) ||
    (str(jsonState.businessName)
      ? `© ${str(jsonState.businessName)}`
      : "");

  return (
    <footer
      className="border-t px-6 py-10 text-sm text-white"
      style={{ backgroundColor: secondary, borderColor: secondary }}
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
        {nav.length > 0 ? (
          <nav className="flex flex-wrap gap-4">
            {nav.map((link, i) => (
              <a
                key={`${link.label}-${i}`}
                href={link.href}
                className="hover:underline"
                style={{ color: primary }}
                {...(link.href.startsWith("http")
                  ? { rel: "noopener noreferrer", target: "_blank" }
                  : {})}
              >
                {link.label}
              </a>
            ))}
          </nav>
        ) : null}
        {social.length > 0 ? (
          <div className="flex flex-wrap gap-4">
            {social.map((link, i) => (
              <a
                key={`${link.label}-${i}`}
                href={link.href}
                className="hover:underline text-white/90"
                {...(link.href.startsWith("http")
                  ? { rel: "noopener noreferrer", target: "_blank" }
                  : {})}
              >
                {link.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      {copyright ? <p className="mt-6 text-white/70">{copyright}</p> : null}
    </footer>
  );
}
```

- [ ] **Step 2: Wire accent + switch cases**

Ensure:

```tsx
  const { primary, secondary } = accent(jsonState);
```

And switch includes (full switch body for clarity):

```tsx
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
            return (
              <ContactSection
                key={section.id}
                section={section}
                jsonState={jsonState}
                primary={primary}
              />
            );
          case "faq":
            return <FaqSection key={section.id} section={section} />;
          case "gallery":
            return <GallerySection key={section.id} section={section} />;
          case "footer":
            return (
              <FooterSection
                key={section.id}
                section={section}
                jsonState={jsonState}
                primary={primary}
                secondary={secondary}
              />
            );
          default:
            return null;
        }
```

- [ ] **Step 3: Verify checks + builds**

From `web/`:

```bash
npx tsx src/components/sectionMap.check.ts
npm run build
```

Expected: `sectionMap.check: ok` and build success.

From `backend-api/`:

```bash
npm test
```

Expected: all pass.

- [ ] **Step 4: Manual smoke (Debug drawer)**

Paste into the debug drawer Apply JSON (or equivalent) a `jsonState` that includes one of each new section, e.g.:

```json
{
  "businessName": "Acme",
  "tagline": "Hello",
  "accentColors": { "primary": "#0ea5e9", "secondary": "#1e293b" },
  "phone": "555-0100",
  "contactEmail": "hi@acme.test",
  "sections": [
    { "id": "c1", "type": "contact", "content": { "address": "1 Main St" } },
    {
      "id": "f1",
      "type": "faq",
      "content": {
        "items": [
          { "question": "Hours?", "answer": "9-5" },
          { "question": "Parking?", "answer": "Street" }
        ]
      }
    },
    {
      "id": "g1",
      "type": "gallery",
      "content": {
        "images": [
          { "url": "https://placehold.co/400x240", "caption": "Shop" },
          { "url": "", "caption": "skip me" }
        ]
      }
    },
    {
      "id": "ft1",
      "type": "footer",
      "content": {
        "links": ["Home", { "label": "About", "href": "/about" }],
        "social": [{ "platform": "X", "url": "https://x.com" }],
        "copyright": "© Acme"
      }
    }
  ]
}
```

Confirm: contact shows phone/email from top-level + address; FAQ first open / second toggles independently; gallery shows one image; footer shows nav + social + copyright; no console errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PreviewPanel.tsx
git commit -m "feat(web): render footer section and finish preview section switch"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| Whitelist faq/gallery/footer | Task 1 |
| Expand contact (phone/email/address + accent form + jsonState fallbacks) | Task 3 |
| FAQ accordion (first open, multi-toggle) | Task 4 |
| Gallery image grid | Task 5 |
| Footer nav/social/copyright + tolerant links | Task 6 |
| Defensive defaults / no throw | Tasks 3–6 helpers |
| Prompt + chatHandler test | Task 2 |
| sectionMap.check update | Task 1 |
| Manual smoke | Task 6 Step 4 |

No placeholders left. Types/names consistent across tasks (`normalizeLinks`, `normalizeFaqItems`, `normalizeImages`, `firstString`).
