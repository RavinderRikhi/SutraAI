import {
  DbService,
  resolvePostgresOptions
} from "../src/lib/postgres-prisma";
import {
  assertChatSuccess,
  buildMarker,
  buildSmokeUserContent,
  isRecord,
  readSmokeConfig,
  taglineOf
} from "./smokeHelpers";

async function main(): Promise<void> {
  const config = readSmokeConfig(process.env);
  const pgOptions = resolvePostgresOptions(config.pg);
  const db = new DbService(pgOptions);
  await db.connect();

  try {
    const tenant = await db.getTenantBySlug(config.slug);
    if (tenant === null) {
      throw new Error(`Tenant not found: ${config.slug}`);
    }

    const marker = buildMarker();
    const jsonState = isRecord(tenant.jsonState) ? tenant.jsonState : {};

    let status: number;
    let body: unknown;
    try {
      const response = await fetch(`${config.apiUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomainSlug: config.slug,
          messages: [{ role: "user", content: buildSmokeUserContent(marker) }],
          jsonState
        })
      });
      status = response.status;
      body = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Fetch failed: ${message}`);
    }

    assertChatSuccess(status, body);

    const updated = await db.getTenantBySlug(config.slug);
    if (updated === null) {
      throw new Error(`Tenant missing after chat: ${config.slug}`);
    }
    const persisted = taglineOf(updated.jsonState);
    if (persisted !== marker) {
      throw new Error(
        `DB tagline mismatch: expected ${marker}, got ${persisted ?? "<missing>"}`
      );
    }

    console.log(`smoke ok slug=${config.slug} marker=${marker}`);
  } finally {
    await db.disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`smoke failed: ${message}`);
  process.exit(1);
});
