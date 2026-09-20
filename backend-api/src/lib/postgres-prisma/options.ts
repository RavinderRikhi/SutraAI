import { Command } from "commander";

const BASE64_PASSWORD_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function decodePgPassword(encoded: string): string {
  const trimmed = encoded.trim();
  if (!BASE64_PASSWORD_PATTERN.test(trimmed)) {
    throw new Error("PGPASSWORD must be valid base64");
  }
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  const roundTrip = Buffer.from(decoded, "utf8").toString("base64");
  const normalizedInput = trimmed.replace(/=+$/, "");
  const normalizedRoundTrip = roundTrip.replace(/=+$/, "");
  if (normalizedRoundTrip !== normalizedInput) {
    throw new Error("PGPASSWORD must be valid base64");
  }
  return decoded;
}

function resolvePgPassword(rawPassword?: string): string {
  const encoded = String(rawPassword ?? "").trim();
  if (encoded === "") {
    return "";
  }
  return decodePgPassword(encoded);
}

export type PostgresConnectionOptions = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
};

export type RawPostgresOptions = {
  pgConnectionString?: string;
  pgHost?: string;
  pgPort?: string | number;
  pgUser?: string;
  pgPassword?: string;
  pgDatabase?: string;
  pgSsl?: boolean | string;
};

function parsePort(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `Invalid pg port: ${value}. Expected integer between 1 and 65535.`
    );
  }
  return parsed;
}

function parseCliBoolean(value: boolean | string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`Invalid pg ssl value: ${value}. Expected true or false.`);
}

function requireNonEmpty(name: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid postgres option: ${name} must be a non-empty string.`);
  }
  return trimmed;
}

export function parsePostgresConnectionString(
  connectionString: string
): PostgresConnectionOptions {
  const trimmed = connectionString.trim();
  if (!trimmed) {
    throw new Error("Invalid postgres option: pg connection string must be non-empty.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid postgres connection string URL.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Invalid postgres connection string protocol.");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error("Invalid postgres option: database must be a non-empty string.");
  }
  const sslMode = parsed.searchParams.get("sslmode");
  const ssl = sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full";

  return {
    host: requireNonEmpty("host", parsed.hostname),
    port: parsed.port ? parsePort(parsed.port) : 5432,
    user: requireNonEmpty("user", decodeURIComponent(parsed.username)),
    password: decodeURIComponent(parsed.password),
    database: requireNonEmpty("database", database),
    ssl
  };
}

export function appendPostgresOptions(program: Command): Command {
  program
    .option(
      "--pg-connection-string <string>",
      "PostgreSQL URL (overrides --pg-host, --pg-user, etc.)",
      ""
    )
    .option("--pg-host <string>", "PostgreSQL host", "localhost")
    .option("--pg-port <number>", "PostgreSQL port", "5432")
    .option("--pg-user <string>", "PostgreSQL user", "postgres")
    .option("--pg-password <string>", "PostgreSQL password (base64-encoded)", "")
    .option("--pg-database <string>", "PostgreSQL database", "postgres")
    .option(
      "--pg-ssl [boolean]",
      "Enable PostgreSQL SSL (true/false)",
      parseCliBoolean,
      undefined
    );
  return program;
}

export function resolvePostgresOptions(
  rawOptions: RawPostgresOptions
): PostgresConnectionOptions {
  const connectionString = rawOptions.pgConnectionString?.trim() ?? "";
  if (connectionString !== "") {
    return parsePostgresConnectionString(connectionString);
  }

  const host = requireNonEmpty("host", rawOptions.pgHost ?? "");
  const user = requireNonEmpty("user", rawOptions.pgUser ?? "");
  const database = requireNonEmpty("database", rawOptions.pgDatabase ?? "");
  const explicitCliSsl = parseCliBoolean(rawOptions.pgSsl);
  const ssl = explicitCliSsl ?? false;

  return {
    host,
    port: parsePort(rawOptions.pgPort ?? ""),
    user,
    password: resolvePgPassword(rawOptions.pgPassword),
    database,
    ssl
  };
}

export function buildPostgresUrl(options: PostgresConnectionOptions): string {
  const user = encodeURIComponent(options.user);
  const password = encodeURIComponent(options.password);
  const base = `postgresql://${user}:${password}@${options.host}:${options.port}/${options.database}`;
  return options.ssl ? `${base}?sslmode=require` : base;
}
