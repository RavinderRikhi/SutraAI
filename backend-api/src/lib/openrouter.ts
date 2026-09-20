import { Command } from "commander";
import OpenAI from "openai";

export type OpenRouterClientOverrides = {
  apiKey?: string;
  baseURL?: string;
  httpReferer?: string;
  appTitle?: string;
};

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const BASE64_KEY_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeOpenRouterApiKey(encoded: string): string {
  const trimmed = encoded.trim();
  if (!BASE64_KEY_PATTERN.test(trimmed)) {
    throw new Error("OPENROUTER_API_KEY must be valid base64");
  }
  const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
  if (decoded === "") {
    throw new Error("OPENROUTER_API_KEY must be valid base64");
  }
  const roundTrip = Buffer.from(decoded, "utf8").toString("base64");
  const normalizedInput = trimmed.replace(/=+$/, "");
  const normalizedRoundTrip = roundTrip.replace(/=+$/, "");
  if (normalizedRoundTrip !== normalizedInput) {
    throw new Error("OPENROUTER_API_KEY must be valid base64");
  }
  return decoded;
}

export function appendOpenAIConfigOptions(program: Command): Command {
  program
    .option("--openrouter-api-key <string>", "OpenRouter API key (base64)", "")
    .option(
      "--openrouter-base-url <string>",
      "OpenRouter API base URL",
      DEFAULT_BASE_URL
    )
    .option("--openrouter-http-referer <string>", "OpenRouter HTTP-Referer header", "")
    .option("--openrouter-app-title <string>", "OpenRouter X-Title header", "");
  return program;
}

export function createOpenRouterClient(
  overrides: OpenRouterClientOverrides = {}
): OpenAI {
  const encoded = (overrides.apiKey ?? "").trim();
  if (encoded === "") {
    throw new Error("OPENROUTER_API_KEY is required");
  }

  const apiKey = decodeOpenRouterApiKey(encoded);

  const baseURL =
    overrides.baseURL !== undefined && overrides.baseURL.trim() !== ""
      ? overrides.baseURL.trim()
      : DEFAULT_BASE_URL;
  const referer = overrides.httpReferer?.trim();
  const title = overrides.appTitle?.trim();
  const defaultHeaders: Record<string, string> = {};
  if (referer) {
    defaultHeaders["HTTP-Referer"] = referer;
  }
  if (title) {
    defaultHeaders["X-Title"] = title;
  }

  return new OpenAI({
    apiKey,
    baseURL,
    ...(Object.keys(defaultHeaders).length > 0 ? { defaultHeaders } : {})
  });
}
