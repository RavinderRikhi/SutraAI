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

function baseFake(overrides: Record<string, unknown> = {}) {
  return {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(overrides),
    tenant: {
      findUnique: async () => null,
      create: async () => sampleTenant,
      update: async () => sampleTenant
    },
    documentChunk: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 })
    },
    ...overrides
  };
}

describe("DbService", () => {
  it("getTenantBySlug returns null when missing", async () => {
    const fake = baseFake();
    const db = new DbService(unusedOptions, fake);
    expect(await db.getTenantBySlug("missing")).to.equal(null);
  });

  it("getTenantBySlug returns the mapped tenant", async () => {
    const fake = baseFake({
      tenant: {
        findUnique: async () => sampleTenant,
        create: async () => sampleTenant,
        update: async () => sampleTenant
      }
    });
    const db = new DbService(unusedOptions, fake);
    expect(await db.getTenantBySlug("acme")).to.deep.equal(sampleTenant);
  });

  it("createTenant passes required fields to prisma", async () => {
    let received: unknown;
    const fake = baseFake({
      tenant: {
        findUnique: async () => null,
        create: async (args: { data: unknown }) => {
          received = args.data;
          return sampleTenant;
        },
        update: async () => sampleTenant
      }
    });
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
    const fake = baseFake({
      tenant: {
        findUnique: async () => null,
        create: async () => sampleTenant,
        update: async (args: unknown) => {
          received = args;
          return { ...sampleTenant, jsonState: { step: 2 } };
        }
      }
    });
    const db = new DbService(unusedOptions, fake);
    await db.updateTenantState("acme", { step: 2 });
    expect(received).to.deep.equal({
      where: { subdomainSlug: "acme" },
      data: { jsonState: { step: 2 } }
    });
  });

  it("getTenantContextChunks returns filename/content rows", async () => {
    const chunks = [
      { filename: "a.md", content: "one" },
      { filename: "b.md", content: "two" }
    ];
    const fake = baseFake({
      tenant: {
        findUnique: async () => ({ chunks }),
        create: async () => sampleTenant,
        update: async () => sampleTenant
      }
    });
    const db = new DbService(unusedOptions, fake);
    expect(await db.getTenantContextChunks("acme")).to.deep.equal(chunks);
  });

  it("getTenantContextChunks returns [] when tenant missing", async () => {
    const fake = baseFake();
    const db = new DbService(unusedOptions, fake);
    expect(await db.getTenantContextChunks("missing")).to.deep.equal([]);
  });

  it("saveDocumentChunks replaces chunks for filenames in the batch", async () => {
    const deleted: unknown[] = [];
    const created: unknown[] = [];
    const fake = baseFake({
      $transaction: async <T>(fn: (tx: typeof fake) => Promise<T>) => fn(fake),
      tenant: {
        findUnique: async () => sampleTenant,
        create: async () => sampleTenant,
        update: async () => sampleTenant
      },
      documentChunk: {
        deleteMany: async (args: unknown) => {
          deleted.push(args);
          return { count: 1 };
        },
        createMany: async (args: unknown) => {
          created.push(args);
          return { count: 2 };
        }
      }
    });
    const db = new DbService(unusedOptions, fake);
    await db.saveDocumentChunks("acme", [
      { filename: "a.md", content: "c1" },
      { filename: "a.md", content: "c2" },
      { filename: "b.md", content: "c3" }
    ]);
    expect(deleted).to.deep.equal([
      {
        where: {
          tenantId: sampleTenant.id,
          filename: { in: ["a.md", "b.md"] }
        }
      }
    ]);
    expect(created).to.deep.equal([
      {
        data: [
          { tenantId: sampleTenant.id, filename: "a.md", content: "c1" },
          { tenantId: sampleTenant.id, filename: "a.md", content: "c2" },
          { tenantId: sampleTenant.id, filename: "b.md", content: "c3" }
        ]
      }
    ]);
  });

  it("saveDocumentChunks throws when tenant missing", async () => {
    const fake = baseFake();
    const db = new DbService(unusedOptions, fake);
    let err: unknown;
    try {
      await db.saveDocumentChunks("missing", [{ filename: "a.md", content: "x" }]);
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(Error);
    expect((err as Error).message).to.equal("Tenant not found: missing");
  });

  it("saveDocumentChunks no-ops on empty chunks", async () => {
    let deleteCalls = 0;
    let createCalls = 0;
    const fake = baseFake({
      tenant: {
        findUnique: async () => sampleTenant,
        create: async () => sampleTenant,
        update: async () => sampleTenant
      },
      documentChunk: {
        deleteMany: async () => {
          deleteCalls += 1;
          return { count: 0 };
        },
        createMany: async () => {
          createCalls += 1;
          return { count: 0 };
        }
      }
    });
    const db = new DbService(unusedOptions, fake);
    await db.saveDocumentChunks("acme", []);
    expect(deleteCalls).to.equal(0);
    expect(createCalls).to.equal(0);
  });
});
