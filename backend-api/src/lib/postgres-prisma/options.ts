import { Command } from "commander";

export type PostgresConnectionOptions = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
};

export type RawPostgresOptions = {
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

export function appendPostgresOptions(program: Command): Command {
  program
    .option("--pg-host <string>", "PostgreSQL host", process.env.PGHOST ?? "localhost")
    .option("--pg-port <number>", "PostgreSQL port", process.env.PGPORT ?? "5432")
    .option(
      "--pg-user <string>",
      "PostgreSQL user",
      process.env.PGUSER ?? process.env.USER ?? "postgres"
    )
    .option("--pg-password <string>", "PostgreSQL password", process.env.PGPASSWORD ?? "")
    .option(
      "--pg-database <string>",
      "PostgreSQL database",
      process.env.PGDATABASE ?? "postgres"
    )
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
  const host = requireNonEmpty("host", rawOptions.pgHost ?? "");
  const user = requireNonEmpty("user", rawOptions.pgUser ?? "");
  const database = requireNonEmpty("database", rawOptions.pgDatabase ?? "");
  const explicitCliSsl = parseCliBoolean(rawOptions.pgSsl);
  const ssl =
    explicitCliSsl !== undefined
      ? explicitCliSsl
      : process.env.PGSSLMODE === "require";

  return {
    host,
    port: parsePort(rawOptions.pgPort ?? ""),
    user,
    password: rawOptions.pgPassword ?? "",
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
