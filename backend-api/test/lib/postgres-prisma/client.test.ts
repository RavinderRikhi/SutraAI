import { expect } from "chai";

import { createPrismaClient } from "../../../src/lib/postgres-prisma/client";
import type { PostgresConnectionOptions } from "../../../src/lib/postgres-prisma/options";

const unusedOptions: PostgresConnectionOptions = {
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "",
  database: "postgres",
  ssl: false
};

describe("createPrismaClient", () => {
  it("returns a handle with client, connect, and disconnect", async () => {
    const handle = createPrismaClient(unusedOptions);
    expect(handle.client).to.exist;
    expect(handle.connect).to.be.a("function");
    expect(handle.disconnect).to.be.a("function");
    await handle.disconnect();
  });
});
