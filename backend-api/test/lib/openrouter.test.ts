import { expect } from "chai";
import { Command } from "commander";

import {
  appendOpenAIConfigOptions,
  createOpenRouterClient
} from "../../src/lib/openrouter";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

describe("createOpenRouterClient", () => {
  const priorKey = process.env.OPENROUTER_API_KEY;
  const priorReferer = process.env.OPENROUTER_HTTP_REFERER;
  const priorTitle = process.env.OPENROUTER_APP_TITLE;

  afterEach(() => {
    if (priorKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = priorKey;
    }
    if (priorReferer === undefined) {
      delete process.env.OPENROUTER_HTTP_REFERER;
    } else {
      process.env.OPENROUTER_HTTP_REFERER = priorReferer;
    }
    if (priorTitle === undefined) {
      delete process.env.OPENROUTER_APP_TITLE;
    } else {
      process.env.OPENROUTER_APP_TITLE = priorTitle;
    }
  });

  it("returns a client with OpenRouter baseURL when apiKey is passed", () => {
    const client = createOpenRouterClient({ apiKey: "test" });
    expect(client.baseURL).to.equal(OPENROUTER_BASE);
  });

  it("throws when apiKey is missing from overrides and env", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => createOpenRouterClient()).to.throw("OPENROUTER_API_KEY is required");
  });
});

describe("appendOpenAIConfigOptions", () => {
  const priorKey = process.env.OPENROUTER_API_KEY;
  const priorBaseUrl = process.env.OPENROUTER_BASE_URL;
  const priorReferer = process.env.OPENROUTER_HTTP_REFERER;
  const priorTitle = process.env.OPENROUTER_APP_TITLE;

  afterEach(() => {
    if (priorKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = priorKey;
    }
    if (priorBaseUrl === undefined) {
      delete process.env.OPENROUTER_BASE_URL;
    } else {
      process.env.OPENROUTER_BASE_URL = priorBaseUrl;
    }
    if (priorReferer === undefined) {
      delete process.env.OPENROUTER_HTTP_REFERER;
    } else {
      process.env.OPENROUTER_HTTP_REFERER = priorReferer;
    }
    if (priorTitle === undefined) {
      delete process.env.OPENROUTER_APP_TITLE;
    } else {
      process.env.OPENROUTER_APP_TITLE = priorTitle;
    }
  });

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

  it("defaults openrouter options when env is unset and argv has no flags", () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.OPENROUTER_HTTP_REFERER;
    delete process.env.OPENROUTER_APP_TITLE;

    const program = appendOpenAIConfigOptions(new Command());
    const opts = program.parse(["node", "sutra"]).opts();

    expect(opts.openrouterApiKey).to.equal("");
    expect(opts.openrouterBaseUrl).to.equal(OPENROUTER_BASE);
    expect(opts.openrouterHttpReferer).to.equal("");
    expect(opts.openrouterAppTitle).to.equal("");
  });
});
