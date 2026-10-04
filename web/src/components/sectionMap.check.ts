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
  ["header", "hero", "services", "contact", "hero"]
);
assert.equal(filtered[0]?.content.title, "Acme");
assert.deepEqual(filtered[3]?.content, { email: "a@b.c" });
assert.deepEqual(filtered[4]?.content, {});
assert.equal(filtered[4]?.id, "bad");
assert.equal(filterRenderableSections({}).length, 0);
assert.equal(filterRenderableSections({ sections: null }).length, 0);

console.log("sectionMap.check: ok");
