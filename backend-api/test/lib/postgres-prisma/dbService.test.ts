import { expect } from "chai";

import { DbService } from "../../../src/lib/postgres-prisma/dbService";
import type { PostgresConnectionOptions } from "../../../src/lib/postgres-prisma/options";

const unusedOptions: PostgresConnectionOptions = {
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "",
  database: "postgres",
  ssl: false
};

const sampleTenant = {
  id: "11111111-1111-1111-1111-111111111111",
  businessName: "Acme",
  subdomainSlug: "acme",
  contactEmail: "a@example.com",
  jsonState: { step: 1 },
  isActive: true,
  planType: "free"
};

describe("DbService", () => {
  it("getTenantBySlug returns null when missing", async () => {
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      tenant: {
        findUnique: async () => null,
        create: async () => sampleTenant,
        update: async () => sampleTenant
      }
    };
    const db = new DbService(unusedOptions, fake);
    expect(await db.getTenantBySlug("missing")).to.equal(null);
  });

  it("getTenantBySlug returns the mapped tenant", async () => {
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      tenant: {
        findUnique: async () => sampleTenant,
        create: async () => sampleTenant,
        update: async () => sampleTenant
      }
    };
    const db = new DbService(unusedOptions, fake);
    expect(await db.getTenantBySlug("acme")).to.deep.equal(sampleTenant);
  });

  it("createTenant passes required fields to prisma", async () => {
    let received: unknown;
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      tenant: {
        findUnique: async () => null,
        create: async (args: { data: unknown }) => {
          received = args.data;
          return sampleTenant;
        },
        update: async () => sampleTenant
      }
    };
    const db = new DbService(unusedOptions, fake);
    await db.createTenant({
      businessName: "Acme",
      subdomainSlug: "acme",
      contactEmail: "a@example.com",
      planType: "free"
    });
    expect(received).to.deep.equal({
      businessName: "Acme",
      subdomainSlug: "acme",
      contactEmail: "a@example.com",
      planType: "free"
    });
  });

  it("updateTenantState updates jsonState by subdomainSlug", async () => {
    let received: unknown;
    const fake = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      tenant: {
        findUnique: async () => null,
        create: async () => sampleTenant,
        update: async (args: unknown) => {
          received = args;
          return { ...sampleTenant, jsonState: { step: 2 } };
        }
      }
    };
    const db = new DbService(unusedOptions, fake);
    await db.updateTenantState("acme", { step: 2 });
    expect(received).to.deep.equal({
      where: { subdomainSlug: "acme" },
      data: { jsonState: { step: 2 } }
    });
  });
});
