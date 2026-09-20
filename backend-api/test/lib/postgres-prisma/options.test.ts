import { expect } from "chai";
import { Command } from "commander";

import {
  appendPostgresOptions,
  buildPostgresUrl,
  parsePostgresConnectionString,
  resolvePostgresOptions
} from "../../../src/lib/postgres-prisma/options";

describe("buildPostgresUrl", () => {
  it("percent-encodes the password", () => {
    const url = buildPostgresUrl({
      host: "localhost",
      port: 5432,
      user: "postgres",
      password: "p@ss/word",
      database: "sutra",
      ssl: false
    });
    expect(url).to.equal(
      "postgresql://postgres:p%40ss%2Fword@localhost:5432/sutra"
    );
  });

  it("appends sslmode=require when ssl is true", () => {
    const url = buildPostgresUrl({
      host: "db.example",
      port: 5432,
      user: "u",
      password: "",
      database: "sutra",
      ssl: true
    });
    expect(url).to.equal(
      "postgresql://u:@db.example:5432/sutra?sslmode=require"
    );
  });
});

describe("parsePostgresConnectionString", () => {
  it("parses user, password, host, port, and database", () => {
    const opts = parsePostgresConnectionString(
      "postgresql://postgres:secret%40word@db.internal:5433/sutra"
    );
    expect(opts).to.deep.equal({
      host: "db.internal",
      port: 5433,
      user: "postgres",
      password: "secret@word",
      database: "sutra",
      ssl: false
    });
  });
});

describe("resolvePostgresOptions", () => {
  it("rejects an empty host", () => {
    expect(() =>
      resolvePostgresOptions({
        pgHost: "  ",
        pgPort: 5432,
        pgUser: "postgres",
        pgPassword: "",
        pgDatabase: "postgres"
      })
    ).to.throw(/host/);
  });

  it("rejects port 0", () => {
    expect(() =>
      resolvePostgresOptions({
        pgHost: "localhost",
        pgPort: 0,
        pgUser: "postgres",
        pgPassword: "",
        pgDatabase: "postgres"
      })
    ).to.throw(/port/);
  });

  it("rejects a non-integer port", () => {
    expect(() =>
      resolvePostgresOptions({
        pgHost: "localhost",
        pgPort: "abc",
        pgUser: "postgres",
        pgPassword: "",
        pgDatabase: "postgres"
      })
    ).to.throw(/port/);
  });

  it("prefers pg connection string over discrete flags", () => {
    const opts = resolvePostgresOptions({
      pgConnectionString: "postgresql://u:p@host.example:5432/mydb",
      pgHost: "ignored",
      pgPort: 1,
      pgUser: "ignored",
      pgPassword: "ignored",
      pgDatabase: "ignored"
    });
    expect(opts.user).to.equal("u");
    expect(opts.password).to.equal("p");
    expect(opts.host).to.equal("host.example");
    expect(opts.database).to.equal("mydb");
  });

  it("decodes base64 pg password from cli options", () => {
    const encoded = Buffer.from("secret@word", "utf8").toString("base64");
    const opts = resolvePostgresOptions({
      pgHost: "localhost",
      pgPort: 5432,
      pgUser: "postgres",
      pgPassword: encoded,
      pgDatabase: "postgres"
    });
    expect(opts.password).to.equal("secret@word");
  });
});

describe("appendPostgresOptions", () => {
  it("registers --pg-host and returns the same Command", () => {
    const program = new Command();
    const returned = appendPostgresOptions(program);
    expect(returned).to.equal(program);
    const opts = program
      .parse(["node", "sutra", "--pg-host", "db.internal"])
      .opts() as { pgHost: string };
    expect(opts.pgHost).to.equal("db.internal");
  });
});
