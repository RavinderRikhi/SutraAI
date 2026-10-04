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
