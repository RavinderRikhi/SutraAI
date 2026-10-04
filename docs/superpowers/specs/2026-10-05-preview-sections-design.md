# Preview Panel — Contact / FAQ / Gallery / Footer Sections

## Goal

Extend the React preview (`PreviewPanel.tsx`) so `jsonState.sections` can render four section types beyond the current header/hero/services/minimal-contact set: an expanded **contact**, plus **faq**, **gallery**, and **footer**. Invalid or partial LLM JSON must not throw at render time.

Also teach the chat system prompt the allowed types and canonical `content` shapes so the model emits usable sections.

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Approach | Expand `PreviewPanel.tsx` in place + whitelist in `sectionMap.ts` (Approach 1) |
| Footer / social links | Prefer `{ label, href }` (or `{ platform, url }`); also accept plain `string[]` and alternate keys (`links` / `navLinks` / `navigation`, `social` / `socialLinks`) |
| FAQ accordion | First item open by default; thereafter each item toggles independently (multi-open allowed) |
| Contact field fallbacks | `section.content` first, then top-level `jsonState` (`phone`, `contactEmail`/`email`, `address`); heading = `content.heading` else `"Contact"` |
| Contact form | Preview-only: `preventDefault` on submit; style submit/focus with `accentColors.primary` |
| Backend | Frontend + short prompt addition in `buildChatSystemPrompt` + minimal `chatHandler.test.ts` assertions |
| Dependencies | None new (React + Tailwind only) |
| Out of scope | New section types beyond these four; embeddings; real form submission; splitting components into separate files; shared `sectionContent.ts` module |

## Architecture

```
jsonState.sections[]
  → filterRenderableSections (sectionMap)  // whitelist includes faq, gallery, footer
  → PreviewPanel switch(section.type)
       header | hero | services | contact | faq | gallery | footer
```

### Files

| Path | Role |
| --- | --- |
| `web/src/components/sectionMap.ts` | Add `faq`, `gallery`, `footer` to `SectionType` and `RENDERABLE` |
| `web/src/components/PreviewPanel.tsx` | Expand `ContactSection`; add `FaqSection`, `GallerySection`, `FooterSection`; wire switch cases; pass `primary` / `secondary` / `jsonState` where needed |
| `web/src/components/sectionMap.check.ts` | Assert new types are kept (not filtered out); update fixtures that previously expected `footer` dropped |
| `backend-api/src/services/sutra/chatHandler.ts` | Append one prompt paragraph: allowed `section.type` values + canonical `content` fields |
| `backend-api/test/services/sutra/chatHandler.test.ts` | Assert prompt includes `faq`, `gallery`, `footer` and key field names (e.g. `question`) |

No Prisma / HTTP contract changes. No new npm packages.

## Content schemas (canonical + defensive)

All string fields use the existing `str()` helper. Missing arrays default to `[]`. Empty optional blocks are omitted from the DOM (heading may still render).

### contact

| Field | Canonical | Fallbacks |
| --- | --- | --- |
| heading | `content.heading` | `"Contact"` |
| phone | `content.phone` | `jsonState.phone` |
| email | `content.email` | `jsonState.contactEmail`, then `jsonState.email` |
| address | `content.address` | `jsonState.address` |

Form fields: name, email, message. Submit button uses `primary` background; input focus/border uses `primary`. Phone renders as `tel:` link when present; email as `mailto:`.

### faq

| Field | Canonical | Notes |
| --- | --- | --- |
| heading | `content.heading` | default `"FAQ"` |
| items | `content.items[]` of `{ question, answer }` | skip non-objects; default question `"Question"`, answer `""` |

UI: button per question with `aria-expanded`; answer panel when open. Initial open set: index `0` only if `items.length > 0`.

### gallery

| Field | Canonical | Notes |
| --- | --- | --- |
| heading | `content.heading` | default `"Gallery"` |
| images | `content.images[]` of `{ url, caption }` | require non-empty string `url`; caption defaults `""`; skip invalid entries |

UI: responsive grid (`sm:grid-cols-2`, `md:grid-cols-3`). `img` `alt` from caption or `"Image"`. If every entry is invalid, show heading with empty grid (no throw, no placeholder cells).

### footer

| Field | Canonical | Notes |
| --- | --- | --- |
| nav | `navLinks` / `links` / `navigation` | normalize via shared link helper |
| social | `socialLinks` / `social` | same normalizer; `{ platform, url }` → label from platform |
| copyright | `content.copyright` | else `content.text`, else `© {jsonState.businessName}` when businessName present |

Link normalizer output: `{ label, href }[]`.

- Object with `label` + `href` (or `url`) → as-is (missing href → `"#"`).
- Object with `platform` + `url`/`href` → label from platform.
- Plain string → `{ label: s, href: "#" }`.
- Non-string/non-object entries skipped.

External `http(s)` links get `rel="noopener noreferrer"`. Styling: `secondary` for footer background or top border; subtle `primary` accent on link hover.

## Error handling

| Case | Behavior |
| --- | --- |
| Unknown `section.type` | Already filtered by `sectionMap`; switch `default` returns `null` |
| Missing `content` object | `sectionMap` already substitutes `{}` |
| Missing arrays / bad item shapes | Normalize to `[]` or skip bad items |
| Missing contact strings after fallbacks | Omit that detail row; form still renders |
| Empty FAQ / gallery lists | Heading only |
| Broken image URLs | Browser broken-image behavior; no React throw |

## Testing

1. **`sectionMap.check.ts`**: fixture includes `faq`, `gallery`, `footer`; filtered types include them in order. Remove/update the assertion that treated `footer` as non-renderable.
2. **`chatHandler.test.ts`**: `buildChatSystemPrompt` output includes `faq`, `gallery`, `footer`, and at least one content field token such as `question`.
3. Manual: Debug drawer JSON with one of each new section type; confirm accordion, accents, and no console errors on partial JSON.

## Prompt addition (backend)

After the existing “sections (array of { id, type, content })” line, append a short paragraph listing:

- Types: `header`, `hero`, `services`, `contact`, `faq`, `gallery`, `footer`
- Typical content keys per type (contact: phone/email/address; faq: items question/answer; gallery: images url/caption; footer: navLinks/socialLinks/copyright)
- Note that nav/social may be strings or `{ label, href }`

Keep the addition compact (one contiguous prompt block) to avoid ballooning token use.
