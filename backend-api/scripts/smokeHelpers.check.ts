import assert from "node:assert/strict";
import {
  assertChatSuccess,
  buildMarker,
  buildSmokeUserContent,
  isNonEmptyRecord,
  isRecord,
  loadDotEnv,
  readSmokeConfig,
  taglineOf
} from "./smokeHelpers.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

assert.equal(isRecord(null), false);
assert.equal(isRecord([]), false);
assert.equal(isRecord({ a: 1 }), true);

assert.equal(isNonEmptyRecord({}), false);
assert.equal(isNonEmptyRecord({ a: 1 }), true);

assert.equal(taglineOf({ tagline: "hi" }), "hi");
assert.equal(taglineOf({ tagline: "  " }), undefined);
assert.equal(taglineOf({}), undefined);
assert.equal(taglineOf(null), undefined);

assert.equal(buildMarker(1700000000000), "smoke-1700000000000");
assert.equal(
  buildSmokeUserContent("smoke-1"),
  "Set tagline to exactly: smoke-1. Keep other fields."
);

const cfg = readSmokeConfig({
  SMOKE_API_URL: "http://127.0.0.1:5000",
  SMOKE_SLUG: "acme",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres"
});
assert.equal(cfg.apiUrl, "http://127.0.0.1:5000");
assert.equal(cfg.slug, "acme");
assert.equal(cfg.pg.pgConnectionString, "postgresql://postgres:postgres@localhost:5432/postgres");

const defaults = readSmokeConfig({});
assert.equal(defaults.apiUrl, "http://localhost:3000");
assert.equal(readSmokeConfig({ PORT: "5000" }).apiUrl, "http://localhost:5000");
assert.equal(
  readSmokeConfig({ HOST: "0.0.0.0", PORT: "3000" }).apiUrl,
  "http://localhost:3000"
);
assert.equal(defaults.slug, "acme");

const ok = assertChatSuccess(200, {
  reply: "Done",
  jsonState: { tagline: "smoke-1", businessName: "Acme" }
});
assert.equal(ok.reply, "Done");
assert.equal(ok.jsonState.tagline, "smoke-1");

assert.throws(() => assertChatSuccess(500, { message: "boom" }), /500/);
assert.throws(() => assertChatSuccess(200, { reply: "", jsonState: { a: 1 } }), /reply/);
assert.throws(() => assertChatSuccess(200, { reply: "x", jsonState: {} }), /jsonState/);

const dotEnvDir = mkdtempSync(join(tmpdir(), "smoke-dotenv-"));
const dotEnvPath = join(dotEnvDir, ".env");
writeFileSync(dotEnvPath, "DATABASE_URL=postgresql://u:p@localhost:5432/db\n");
const dotEnvProbe: NodeJS.ProcessEnv = {};
loadDotEnv(dotEnvPath, dotEnvProbe);
assert.equal(dotEnvProbe.DATABASE_URL, "postgresql://u:p@localhost:5432/db");

console.log("smokeHelpers.check: ok");
