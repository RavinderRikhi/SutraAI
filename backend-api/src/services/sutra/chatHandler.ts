import type OpenAI from "openai";

export const CHAT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ChatRequestBody = {
  subdomainSlug: string;
  messages: ChatMessage[];
  jsonState: Record<string, unknown>;
};

const VALID_ROLES = new Set(["user", "assistant", "system"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseChatRequestBody(body: unknown): ChatRequestBody | null {
  if (!isRecord(body)) {
    return null;
  }
  const subdomainSlug =
    typeof body.subdomainSlug === "string" ? body.subdomainSlug.trim() : "";
  if (subdomainSlug === "") {
    return null;
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return null;
  }
  const messages: ChatMessage[] = [];
  for (const item of body.messages) {
    if (!isRecord(item)) {
      return null;
    }
    const role = item.role;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (typeof role !== "string" || !VALID_ROLES.has(role) || content === "") {
      return null;
    }
    messages.push({ role: role as ChatMessage["role"], content });
  }
  if (!isRecord(body.jsonState)) {
    return null;
  }
  return { subdomainSlug, messages, jsonState: body.jsonState };
}

export function buildChatSystemPrompt(
  tenant: { subdomainSlug: string; businessName: string },
  jsonState: Record<string, unknown>
): string {
  return [
    "You are SutraAI, a website builder assistant.",
    'Respond with JSON only, shape: { "reply": string, "jsonState": object }.',
    "jsonState must be the FULL site configuration after this turn (not a patch).",
    "Include at least: businessName, tagline, accentColors { primary, secondary }, sections (array of { id, type, content }).",
    "Merge the user's request into the current jsonState; keep unchanged fields.",
    `Tenant slug: ${tenant.subdomainSlug}`,
    `Tenant business name: ${tenant.businessName}`,
    `Current jsonState: ${JSON.stringify(jsonState)}`
  ].join("\n");
}

export function parseChatModelPayload(
  content: string | null | undefined
): { reply: string; jsonState: Record<string, unknown> } | null {
  if (content === undefined || content === null || content.trim() === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  const jsonState = parsed.jsonState;
  if (reply === "" || !isRecord(jsonState)) {
    return null;
  }
  return { reply, jsonState };
}

export function createChatCompletion(
  openRouter: OpenAI,
  systemContent: string,
  messages: ChatMessage[]
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return openRouter.chat.completions.create({
    model: CHAT_MODEL,
    messages: [{ role: "system", content: systemContent }, ...messages],
    response_format: { type: "json_object" }
  });
}
