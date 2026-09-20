import { expect } from "chai";
import request from "supertest";

import {
  ExpressServer,
  initializeServerContext,
  normalizeCorsOrigins
} from "../../src/lib/base-server";

describe("ExpressServer CORS", () => {
  it("returns Access-Control-Allow-Origin for an allowed Origin on GET", async () => {
    const server = new ExpressServer(
      initializeServerContext({
        serviceName: "test",
        host: "127.0.0.1",
        port: 0,
        corsOrigins: normalizeCorsOrigins("http://localhost:5173")
      })
    );
    server.registerRoutes();
    const app = server.getApp();

    const response = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:5173");

    expect(response.status).to.equal(200);
    expect(response.headers["access-control-allow-origin"]).to.equal(
      "http://localhost:5173"
    );
    expect(response.body.status).to.equal("ok");
  });

  it("responds 204 to OPTIONS preflight for an allowed origin", async () => {
    const server = new ExpressServer(
      initializeServerContext({
        serviceName: "test",
        host: "127.0.0.1",
        port: 0,
        corsOrigins: normalizeCorsOrigins("http://127.0.0.1:5173")
      })
    );
    server.registerRoutes();
    const app = server.getApp();

    const response = await request(app)
      .options("/sutra")
      .set("Origin", "http://127.0.0.1:5173")
      .set("Access-Control-Request-Method", "GET");

    expect(response.status).to.equal(204);
    expect(response.headers["access-control-allow-origin"]).to.equal(
      "http://127.0.0.1:5173"
    );
  });
});
