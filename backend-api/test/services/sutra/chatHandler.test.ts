import { expect } from "chai";
import type OpenAI from "openai";

import {
  CHAT_MODEL,
  DEFAULT_RAG_MAX_CHARS,
  DEFAULT_RAG_MAX_CHUNKS,
  buildChatSystemPrompt,
  createChatCompletion,
  formatBusinessContextBlock,
  parseChatModelPayload,
  parseChatRequestBody,
  selectContextChunks
} from "../../../src/services/sutra/chatHandler";

describe("chatHandler utilities", () => {
  it("parseChatRequestBody returns null when subdomainSlug is missing", () => {
    expect(
      parseChatRequestBody({
        messages: [{ role: "user", content: "hi" }],
        jsonState: {}
      })
    ).to.equal(null);
  });

  it("parseChatRequestBody returns trimmed slug and messages", () => {
    expect(
      parseChatRequestBody({
        subdomainSlug: " acme ",
        messages: [{ role: "user", content: " hi " }],
        jsonState: { businessName: "Acme" }
      })
    ).to.deep.equal({
      subdomainSlug: "acme",
      messages: [{ role: "user", content: "hi" }],
      jsonState: { businessName: "Acme" }
    });
  });

  it("parseChatModelPayload returns null for non-JSON", () => {
    expect(parseChatModelPayload("not json")).to.equal(null);
  });

  it("parseChatModelPayload returns reply and jsonState", () => {
    expect(
      parseChatModelPayload(
        JSON.stringify({ reply: "ok", jsonState: { tagline: "x" } })
      )
    ).to.deep.equal({ reply: "ok", jsonState: { tagline: "x" } });
  });

  it("buildChatSystemPrompt includes tenant slug and jsonState", () => {
    const prompt = buildChatSystemPrompt(
      { subdomainSlug: "acme", businessName: "Acme" },
      { businessName: "Acme" }
    );
    expect(prompt).to.include("Tenant slug: acme");
    expect(prompt).to.include("Tenant business name: Acme");
    expect(prompt).to.include('"businessName":"Acme"');
  });

  it("createChatCompletion calls openRouter with CHAT_MODEL and json_object format", async () => {
    let received: unknown;
    const openRouter = {
      chat: {
        completions: {
          create: async (args: unknown) => {
            received = args;
            return { choices: [{ message: { content: "{}" } }] };
          }
        }
      }
    } as unknown as OpenAI;

    await createChatCompletion(openRouter, "system", [
      { role: "user", content: "hi" }
    ]);

    expect(received).to.deep.equal({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "hi" }
      ],
      response_format: { type: "json_object" }
    });
  });
});

describe("selectContextChunks", () => {
  it("keeps all chunks under defaults", () => {
    const chunks = [
      { filename: "a.txt", content: "one" },
      { filename: "a.txt", content: "two" }
    ];
    expect(selectContextChunks(chunks)).to.deep.equal({
      kept: chunks,
      truncated: false
    });
  });

  it("stops at maxChunks", () => {
    const chunks = [
      { filename: "a.txt", content: "1" },
      { filename: "a.txt", content: "2" },
      { filename: "a.txt", content: "3" }
    ];
    expect(selectContextChunks(chunks, { maxChunks: 2 })).to.deep.equal({
      kept: chunks.slice(0, 2),
      truncated: true
    });
  });

  it("stops at maxChars without splitting a chunk", () => {
    const chunks = [
      { filename: "a.txt", content: "abcd" },
      { filename: "a.txt", content: "efgh" }
    ];
    expect(selectContextChunks(chunks, { maxChars: 4 })).to.deep.equal({
      kept: [chunks[0]],
      truncated: true
    });
  });

  it("returns empty kept when first chunk exceeds maxChars", () => {
    const chunks = [{ filename: "a.txt", content: "too-long" }];
    expect(selectContextChunks(chunks, { maxChars: 3 })).to.deep.equal({
      kept: [],
      truncated: true
    });
  });

  it("uses DEFAULT_RAG_MAX_CHUNKS and DEFAULT_RAG_MAX_CHARS", () => {
    expect(DEFAULT_RAG_MAX_CHUNKS).to.equal(20);
    expect(DEFAULT_RAG_MAX_CHARS).to.equal(8000);
  });
});

describe("formatBusinessContextBlock", () => {
  it("groups by filename with Document labels", () => {
    const block = formatBusinessContextBlock([
      { filename: "menu.pdf", content: "Espresso: $3.50" },
      { filename: "menu.pdf", content: "Cappuccino: $5.00" },
      { filename: "hours.txt", content: "Mon-Fri 9-5" }
    ]);
    expect(block).to.include("# BUSINESS CONTEXT FROM UPLOADED DOCUMENTS");
    expect(block).to.include(
      "Use the following verified facts (prices, services, opening hours) to update the website state:"
    );
    expect(block).to.include("[Document: menu.pdf]");
    expect(block).to.include("- Espresso: $3.50");
    expect(block).to.include("- Cappuccino: $5.00");
    expect(block).to.include("[Document: hours.txt]");
    expect(block).to.include("- Mon-Fri 9-5");
  });
});

describe("buildChatSystemPrompt with context", () => {
  it("omits business context when contextBlock is omitted or empty", () => {
    const prompt = buildChatSystemPrompt(
      { subdomainSlug: "acme", businessName: "Acme" },
      { businessName: "Acme" }
    );
    expect(prompt).to.not.include("BUSINESS CONTEXT FROM UPLOADED DOCUMENTS");
    expect(prompt).to.not.include("strictly prioritize");

    const empty = buildChatSystemPrompt(
      { subdomainSlug: "acme", businessName: "Acme" },
      { businessName: "Acme" },
      ""
    );
    expect(empty).to.not.include("BUSINESS CONTEXT FROM UPLOADED DOCUMENTS");
  });

  it("appends context block and guardrail when contextBlock is non-empty", () => {
    const block = formatBusinessContextBlock([
      { filename: "menu.pdf", content: "Espresso: $3.50" }
    ]);
    const prompt = buildChatSystemPrompt(
      { subdomainSlug: "acme", businessName: "Acme" },
      { businessName: "Acme" },
      block
    );
    expect(prompt).to.include(block);
    expect(prompt).to.include("strictly prioritize");
    expect(prompt).to.include("uploaded context");
    expect(prompt).to.include("jsonState");
  });
});
