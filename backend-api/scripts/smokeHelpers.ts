import type { RawPostgresOptions } from "../src/lib/postgres-prisma";

export type SmokeConfig = {
  apiUrl: string;
  slug: string;
  pg: RawPostgresOptions;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyRecord(
  value: unknown
): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length > 0;
}

export function taglineOf(jsonState: unknown): string | undefined {
  if (!isRecord(jsonState)) {
    return undefined;
  }
  const tagline = jsonState.tagline;
  if (typeof tagline !== "string") {
    return undefined;
  }
  const trimmed = tagline.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function buildMarker(nowMs: number = Date.now()): string {
  return `smoke-${nowMs}`;
}

export function buildSmokeUserContent(marker: string): string {
  return `Set tagline to exactly: ${marker}. Keep other fields.`;
}

export function readSmokeConfig(env: NodeJS.ProcessEnv): SmokeConfig {
  const apiUrl = (env.SMOKE_API_URL ?? "http://localhost:5000").trim();
  const slug = (env.SMOKE_SLUG ?? "acme").trim();
  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  const pg: RawPostgresOptions =
    databaseUrl !== ""
      ? { pgConnectionString: databaseUrl }
      : {
          pgHost: env.PGHOST ?? env.PG_HOST ?? "localhost",
          pgPort: env.PGPORT ?? env.PG_PORT ?? "5432",
          pgUser: env.PGUSER ?? env.PG_USER ?? "postgres",
          pgPassword: env.PGPASSWORD ?? env.PG_PASSWORD ?? "",
          pgDatabase: env.PGDATABASE ?? env.PG_DATABASE ?? "postgres",
          pgSsl: env.PGSSL ?? env.PG_SSL
        };
  return { apiUrl, slug, pg };
}

export function assertChatSuccess(
  status: number,
  body: unknown
): { reply: string; jsonState: Record<string, unknown> } {
  if (status !== 200) {
    const message =
      isRecord(body) && typeof body.message === "string"
        ? body.message
        : "request failed";
    throw new Error(`Expected HTTP 200, got ${status}: ${message}`);
  }
  if (!isRecord(body)) {
    throw new Error("Response body must be an object");
  }
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if (reply === "") {
    throw new Error("Response missing non-empty reply");
  }
  if (!isNonEmptyRecord(body.jsonState)) {
    throw new Error("Response missing non-empty jsonState object");
  }
  return { reply, jsonState: body.jsonState };
}
