import { Command } from "commander";
import OpenAI from "openai";

export type OpenRouterClientOverrides = {
  apiKey?: string;
  baseURL?: string;
};

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export function appendOpenAIConfigOptions(program: Command): Command {
  program
    .option(
      "--openrouter-api-key <string>",
      "OpenRouter API key",
      process.env.OPENROUTER_API_KEY ?? ""
    )
    .option(
      "--openrouter-base-url <string>",
      "OpenRouter API base URL",
      process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL
    )
    .option(
      "--openrouter-http-referer <string>",
      "OpenRouter HTTP-Referer header",
      process.env.OPENROUTER_HTTP_REFERER ?? ""
    )
    .option(
      "--openrouter-app-title <string>",
      "OpenRouter X-Title header",
      process.env.OPENROUTER_APP_TITLE ?? ""
    );
  return program;
}

export function createOpenRouterClient(
  overrides: OpenRouterClientOverrides = {}
): OpenAI {
  const apiKey = (overrides.apiKey ?? process.env.OPENROUTER_API_KEY ?? "").trim();
  if (apiKey === "") {
    throw new Error("OPENROUTER_API_KEY is required");
  }

  const baseURL = overrides.baseURL ?? DEFAULT_BASE_URL;
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  const title = process.env.OPENROUTER_APP_TITLE?.trim();
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
