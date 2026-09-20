import { expect } from "chai";
import request from "supertest";

import {
  createSutraApp,
  initializeAppOptions
} from "../../../src/services/sutra/index";

describe("SutraServer", () => {
  const app = createSutraApp({
    serviceName: "sutra",
    host: "127.0.0.1",
    port: 0,
    corsOrigins: []
  });

  it("GET /health returns ok", async () => {
    const response = await request(app).get("/health");
    expect(response.status).to.equal(200);
    expect(response.body.status).to.equal("ok");
    expect(response.body.service).to.equal("sutra");
  });

  it("GET /sutra returns ok", async () => {
    const response = await request(app).get("/sutra");
    expect(response.status).to.equal(200);
    expect(response.body).to.deep.include({
      status: "ok",
      service: "sutra"
    });
  });
});

describe("initializeAppOptions postgres flags", () => {
  it("parses --pg-host", () => {
    const opts = initializeAppOptions([
      "node",
      "sutra",
      "--pg-host",
      "db.internal",
      "--pg-database",
      "sutra"
    ]);
    expect(opts.pgHost).to.equal("db.internal");
    expect(opts.pgDatabase).to.equal("sutra");
  });
});
