import { expect } from "chai";
import { Command } from "commander";

import {
  appendOpenAIConfigOptions,
  createOpenRouterClient
} from "../../src/lib/openrouter";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const encodedTestKey = Buffer.from("test", "utf8").toString("base64");

describe("createOpenRouterClient", () => {
  it("returns a client with OpenRouter baseURL when apiKey is passed", () => {
    const client = createOpenRouterClient({ apiKey: encodedTestKey });
    expect(client.baseURL).to.equal(OPENROUTER_BASE);
  });

  it("throws when apiKey is missing from overrides", () => {
    expect(() => createOpenRouterClient()).to.throw("OPENROUTER_API_KEY is required");
  });

  it("throws when apiKey is not valid base64", () => {
    expect(() => createOpenRouterClient({ apiKey: "not!!!base64" })).to.throw(
      "OPENROUTER_API_KEY must be valid base64"
    );
  });

  it("throws when base64 decodes to whitespace only", () => {
    const whitespaceOnly = Buffer.from("   ", "utf8").toString("base64");
    expect(() => createOpenRouterClient({ apiKey: whitespaceOnly })).to.throw(
      "OPENROUTER_API_KEY must be valid base64"
    );
  });

  it("uses baseURL override when provided", () => {
    const client = createOpenRouterClient({
      apiKey: encodedTestKey,
      baseURL: "https://custom.example/v1"
    });
    expect(client.baseURL).to.equal("https://custom.example/v1");
  });
});

describe("appendOpenAIConfigOptions", () => {
  it("returns the same Command instance", () => {
    const program = new Command();
    expect(appendOpenAIConfigOptions(program)).to.equal(program);
  });

  it("parses --openrouter-api-key from argv", () => {
    const program = appendOpenAIConfigOptions(new Command());
    const opts = program
      .parse(["node", "sutra", "--openrouter-api-key", "sk-test"])
      .opts();
    expect(opts.openrouterApiKey).to.equal("sk-test");
  });

  it("defaults openrouter options when argv has no flags", () => {
    const program = appendOpenAIConfigOptions(new Command());
    const opts = program.parse(["node", "sutra"]).opts();

    expect(opts.openrouterApiKey).to.equal("");
    expect(opts.openrouterBaseUrl).to.equal(OPENROUTER_BASE);
    expect(opts.openrouterHttpReferer).to.equal("");
    expect(opts.openrouterAppTitle).to.equal("");
  });
});
