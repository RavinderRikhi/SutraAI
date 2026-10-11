import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

import type { PostgresConnectionOptions } from "./options";

export type PrismaClientHandle = {
  client: PrismaClient;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
};

export function createPrismaClient(
  options: PostgresConnectionOptions
): PrismaClientHandle {
  const pool = new Pool({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    ssl: options.ssl ? { rejectUnauthorized: true } : undefined
  });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });

  return {
    client,
    async connect(): Promise<void> {
      await client.$connect();
      await pool.query("SELECT 1");
    },
    async disconnect(): Promise<void> {
      await client.$disconnect();
      await pool.end();
    }
  };
}
