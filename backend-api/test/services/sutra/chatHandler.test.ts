import { expect } from "chai";
import type OpenAI from "openai";

import {
  CHAT_MODEL,
  buildChatSystemPrompt,
  createChatCompletion,
  parseChatModelPayload,
  parseChatRequestBody
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
