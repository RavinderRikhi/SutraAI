import { expect } from "chai";
import request from "supertest";
import type OpenAI from "openai";

import type { DbService } from "../../../src/lib/postgres-prisma";
import { initializeServerContext } from "../../../src/lib/base-server";
import { SutraServer } from "../../../src/services/sutra/index";

function buildApp(deps: { db?: DbService; openRouter?: OpenAI }) {
  const context = initializeServerContext({
    serviceName: "sutra",
    host: "127.0.0.1",
    port: 3000,
    corsOrigins: []
  });
  const server = new SutraServer({
    ...context,
    db: deps.db,
    openRouter: deps.openRouter
  });
  server.registerRoutes();
  return server.getApp();
}

const sampleTenant = {
  id: "11111111-1111-1111-1111-111111111111",
  businessName: "Acme",
  subdomainSlug: "acme",
  contactEmail: "a@example.com",
  jsonState: { businessName: "Acme" },
  isActive: true,
  planType: "free"
};

describe("POST /api/chat", () => {
  it("returns 503 when db and openRouter are missing", async () => {
    const app = buildApp({});
    const res = await request(app)
      .post("/api/chat")
      .send({
        subdomainSlug: "acme",
        messages: [{ role: "user", content: "hi" }],
        jsonState: {}
      });
    expect(res.status).to.equal(503);
    expect(res.body.message).to.equal("Chat unavailable");
  });

  it("returns 400 when subdomainSlug is missing", async () => {
    const app = buildApp({ db: {} as DbService, openRouter: {} as OpenAI });
    const res = await request(app)
      .post("/api/chat")
      .send({
        messages: [{ role: "user", content: "hi" }],
        jsonState: {}
      });
    expect(res.status).to.equal(400);
  });

  it("returns 404 when tenant is not found", async () => {
    const db = {
      getTenantBySlug: async () => null,
      updateTenantState: async () => sampleTenant
    } as unknown as DbService;
    const openRouter = {
      chat: { completions: { create: async () => ({}) } }
    } as unknown as OpenAI;
    const app = buildApp({ db, openRouter });
    const res = await request(app)
      .post("/api/chat")
      .send({
        subdomainSlug: "missing",
        messages: [{ role: "user", content: "hi" }],
        jsonState: {}
      });
    expect(res.status).to.equal(404);
    expect(res.body.message).to.equal("Tenant not found");
  });

  it("returns 200 and persists jsonState on valid model response", async () => {
    let updatedState: unknown;
    const db = {
      getTenantBySlug: async () => sampleTenant,
      updateTenantState: async (_slug: string, state: unknown) => {
        updatedState = state;
        return { ...sampleTenant, jsonState: state };
      }
    } as unknown as DbService;

    const modelJson = {
      reply: "Done!",
      jsonState: {
        businessName: "Acme",
        tagline: "We ship",
        accentColors: { primary: "#000", secondary: "#fff" },
        sections: []
      }
    };

    const openRouter = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: JSON.stringify(modelJson) } }]
          })
        }
      }
    } as unknown as OpenAI;

    const app = buildApp({ db, openRouter });
    const res = await request(app)
      .post("/api/chat")
      .send({
        subdomainSlug: "acme",
        messages: [{ role: "user", content: "Add a tagline" }],
        jsonState: { businessName: "Acme" }
      });

    expect(res.status).to.equal(200);
    expect(res.body.reply).to.equal("Done!");
    expect(res.body.jsonState).to.deep.equal(modelJson.jsonState);
    expect(updatedState).to.deep.equal(modelJson.jsonState);
  });

  it("returns 502 when model content is not valid JSON", async () => {
    const db = {
      getTenantBySlug: async () => sampleTenant,
      updateTenantState: async () => sampleTenant
    } as unknown as DbService;
    const openRouter = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: "not json" } }]
          })
        }
      }
    } as unknown as OpenAI;
    const app = buildApp({ db, openRouter });
    const res = await request(app)
      .post("/api/chat")
      .send({
        subdomainSlug: "acme",
        messages: [{ role: "user", content: "hi" }],
        jsonState: {}
      });
    expect(res.status).to.equal(502);
    expect(res.body.message).to.equal("Invalid model response");
  });

  it("returns 502 when completions.create throws", async () => {
    const db = {
      getTenantBySlug: async () => sampleTenant,
      updateTenantState: async () => sampleTenant
    } as unknown as DbService;
    const openRouter = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("upstream");
          }
        }
      }
    } as unknown as OpenAI;
    const app = buildApp({ db, openRouter });
    const res = await request(app)
      .post("/api/chat")
      .send({
        subdomainSlug: "acme",
        messages: [{ role: "user", content: "hi" }],
        jsonState: {}
      });
    expect(res.status).to.equal(502);
    expect(res.body.message).to.equal("Chat model failed");
  });
});
