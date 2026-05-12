import OpenAI from "openai";

function trimEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/**
 * Shared OpenAI SDK client. When using OpenRouter (or another OpenAI-compatible host),
 * set OPENAI_BASE_URL (e.g. https://openrouter.ai/api/v1) and keep the gateway key in OPENAI_API_KEY.
 */
export function createOpenAIClient(): OpenAI {
  const apiKey = trimEnv("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  const baseURL = trimEnv("OPENAI_BASE_URL");
  const headers: Record<string, string> = {};
  const referer = trimEnv("OPENROUTER_HTTP_REFERER");
  const title = trimEnv("OPENROUTER_APP_TITLE");
  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;

  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(Object.keys(headers).length > 0 ? { defaultHeaders: headers } : {}),
  });
}

/** Where the OpenAI SDK sends chat/embeddings (official API vs proxy). */
export type OpenAICompatibleGateway = "openai" | "openrouter" | "custom";

export function getOpenAICompatibleGateway(): OpenAICompatibleGateway {
  const base = trimEnv("OPENAI_BASE_URL");
  if (!base) return "openai";
  try {
    const host = new URL(base).hostname.toLowerCase();
    if (host === "openrouter.ai" || host.endsWith(".openrouter.ai")) return "openrouter";
  } catch {
    /* ignore invalid URL */
  }
  return "custom";
}

/** Chat / vision model id (OpenRouter uses slugs like openai/gpt-4o-mini). */
export function getOpenAIChatModel(): string {
  return trimEnv("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";
}
