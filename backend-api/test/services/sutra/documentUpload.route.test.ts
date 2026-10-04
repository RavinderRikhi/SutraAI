import { expect } from "chai";
import request from "supertest";

import type { DbService } from "../../../src/lib/postgres-prisma";
import { initializeServerContext } from "../../../src/lib/base-server";
import { SutraServer } from "../../../src/services/sutra/index";
import { CHUNK_SIZE } from "../../../src/services/sutra/documentUpload";

function buildApp(deps: { db?: DbService }) {
  const context = initializeServerContext({
    serviceName: "sutra",
    host: "127.0.0.1",
    port: 3000,
    corsOrigins: []
  });
  const server = new SutraServer({
    ...context,
    db: deps.db
  });
  server.registerRoutes();
  return server.getApp();
}

describe("POST /api/documents/upload", () => {
  it("returns 503 when db is missing", async () => {
    const app = buildApp({});
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "acme")
      .attach("files", Buffer.from("hello"), "a.txt");
    expect(res.status).to.equal(503);
    expect(res.body.message).to.equal("Upload unavailable");
  });

  it("returns 400 when subdomainSlug is missing", async () => {
    const db = {
      saveDocumentChunks: async () => undefined
    } as unknown as DbService;
    const app = buildApp({ db });
    const res = await request(app)
      .post("/api/documents/upload")
      .attach("files", Buffer.from("hello"), "a.txt");
    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal("Invalid upload request");
  });

  it("returns 400 when no files are attached", async () => {
    const db = {
      saveDocumentChunks: async () => undefined
    } as unknown as DbService;
    const app = buildApp({ db });
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "acme");
    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal("Invalid upload request");
  });

  it("returns 400 when any extension is disallowed", async () => {
    const db = {
      saveDocumentChunks: async () => undefined
    } as unknown as DbService;
    const app = buildApp({ db });
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "acme")
      .attach("files", Buffer.from("hello"), "a.txt")
      .attach("files", Buffer.from("x"), "b.doc");
    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal("Only .pdf and .txt files are allowed");
  });

  it("returns 400 when extractable text is empty", async () => {
    const db = {
      saveDocumentChunks: async () => undefined
    } as unknown as DbService;
    const app = buildApp({ db });
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "acme")
      .attach("files", Buffer.from("   \n"), "blank.txt");
    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal("No extractable text");
  });

  it("returns 404 when tenant is missing", async () => {
    const db = {
      saveDocumentChunks: async () => {
        throw new Error("Tenant not found: missing");
      }
    } as unknown as DbService;
    const app = buildApp({ db });
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "missing")
      .attach("files", Buffer.from("hello"), "a.txt");
    expect(res.status).to.equal(404);
    expect(res.body.message).to.equal("Tenant not found");
  });

  it("returns 200 and saves flattened chunks for multiple files", async () => {
    let saved: { slug: string; chunks: Array<{ filename: string; content: string }> } | null =
      null;
    const db = {
      saveDocumentChunks: async (
        slug: string,
        chunks: Array<{ filename: string; content: string }>
      ) => {
        saved = { slug, chunks };
      }
    } as unknown as DbService;
    const app = buildApp({ db });
    const long = "a".repeat(CHUNK_SIZE + 1);
    const res = await request(app)
      .post("/api/documents/upload")
      .field("subdomainSlug", "acme")
      .attach("files", Buffer.from(long), "menu.txt")
      .attach("files", Buffer.from("hours open"), "hours.txt");

    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({
      success: true,
      message: "Documents ingested successfully",
      files: [
        { filename: "menu.txt", chunksIngested: 2 },
        { filename: "hours.txt", chunksIngested: 1 }
      ]
    });
    expect(saved).to.not.equal(null);
    expect(saved!.slug).to.equal("acme");
    expect(saved!.chunks).to.have.length(3);
    expect(saved!.chunks.map((c) => c.filename)).to.deep.equal([
      "menu.txt",
      "menu.txt",
      "hours.txt"
    ]);
  });
});
