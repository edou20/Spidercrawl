/**
 * AI Provider Abstraction
 * ========================
 * A unified interface for calling LLMs (Gemini, OpenAI, OpenRouter, etc.)
 * so the rest of the system doesn't care which provider is active.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { logger } from "../lib/logger.js";

// ─── Types ───────────────────────────────────────────────────────

export interface AICompletionRequest {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface AIVisionRequest {
  prompt: string;
  imageUrl?: string;
  imageBase64?: string;
  imageMimeType?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface AIResponse {
  text: string;
  provider: string;
  model: string;
  tokensUsed?: number;
}

type ProviderName = "openrouter" | "gemini" | "openai";

// ─── Provider Detection ─────────────────────────────────────────

export function detectProvider(): ProviderName | null {
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.GOOGLE_AI_API_KEY)  return "gemini";
  if (process.env.OPENAI_API_KEY)     return "openai";
  return null;
}

export function getConfiguredProviders(): ProviderName[] {
  const providers: ProviderName[] = [];
  if (process.env.OPENROUTER_API_KEY) providers.push("openrouter");
  if (process.env.GOOGLE_AI_API_KEY)  providers.push("gemini");
  if (process.env.OPENAI_API_KEY)     providers.push("openai");
  return providers;
}

// ─── OpenRouter Implementation ──────────────────────────────────

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-001";

function openrouterClient() {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://spidercrawl.dev",
      "X-Title": "Spidercrawl",
    },
  });
}

async function openrouterComplete(req: AICompletionRequest): Promise<AIResponse> {
  const client = openrouterClient();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });
  messages.push({ role: "user", content: req.prompt });

  const result = await client.chat.completions.create({
    model: OPENROUTER_MODEL,
    messages,
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxTokens ?? 4096,
    response_format: req.jsonMode ? { type: "json_object" } : undefined,
  });

  return {
    text: result.choices[0]?.message?.content || "",
    provider: "openrouter",
    model: OPENROUTER_MODEL,
    tokensUsed: result.usage?.total_tokens,
  };
}

async function openrouterVision(req: AIVisionRequest): Promise<AIResponse> {
  const client = openrouterClient();
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: "text", text: req.prompt },
  ];

  if (req.imageUrl) {
    content.push({ type: "image_url", image_url: { url: req.imageUrl } });
  } else if (req.imageBase64) {
    const mime = req.imageMimeType || "image/png";
    content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${req.imageBase64}` } });
  }

  const result = await client.chat.completions.create({
    model: OPENROUTER_MODEL,
    messages: [{ role: "user", content }],
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxTokens ?? 4096,
  });

  return {
    text: result.choices[0]?.message?.content || "",
    provider: "openrouter",
    model: OPENROUTER_MODEL,
    tokensUsed: result.usage?.total_tokens,
  };
}

// ─── Gemini Implementation ──────────────────────────────────────

async function geminiComplete(req: AICompletionRequest): Promise<AIResponse> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
  const modelId = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: req.temperature ?? 0.2,
      maxOutputTokens: req.maxTokens ?? 4096,
      responseMimeType: req.jsonMode ? "application/json" : "text/plain",
    },
  });

  const fullPrompt = req.systemPrompt
    ? `${req.systemPrompt}\n\n${req.prompt}`
    : req.prompt;

  const result = await model.generateContent(fullPrompt);
  return {
    text: result.response.text(),
    provider: "gemini",
    model: modelId,
    tokensUsed: result.response.usageMetadata?.totalTokenCount,
  };
}

async function geminiVision(req: AIVisionRequest): Promise<AIResponse> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
  const modelId = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: req.temperature ?? 0.2,
      maxOutputTokens: req.maxTokens ?? 4096,
      responseMimeType: req.jsonMode ? "application/json" : "text/plain",
    },
  });

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: req.prompt },
  ];
  if (req.imageBase64) {
    parts.push({ inlineData: { mimeType: req.imageMimeType || "image/png", data: req.imageBase64 } });
  }

  const result = await model.generateContent(parts);
  return {
    text: result.response.text(),
    provider: "gemini",
    model: modelId,
    tokensUsed: result.response.usageMetadata?.totalTokenCount,
  };
}

// ─── OpenAI Implementation ──────────────────────────────────────

async function openaiComplete(req: AICompletionRequest): Promise<AIResponse> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });
  messages.push({ role: "user", content: req.prompt });

  const result = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxTokens ?? 4096,
    response_format: req.jsonMode ? { type: "json_object" } : undefined,
  });

  return {
    text: result.choices[0]?.message?.content || "",
    provider: "openai",
    model: "gpt-4o-mini",
    tokensUsed: result.usage?.total_tokens,
  };
}

async function openaiVision(req: AIVisionRequest): Promise<AIResponse> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [{ type: "text", text: req.prompt }];

  if (req.imageUrl) {
    content.push({ type: "image_url", image_url: { url: req.imageUrl } });
  } else if (req.imageBase64) {
    const mime = req.imageMimeType || "image/png";
    content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${req.imageBase64}` } });
  }

  const result = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content }],
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxTokens ?? 4096,
  });

  return {
    text: result.choices[0]?.message?.content || "",
    provider: "openai",
    model: "gpt-4o-mini",
    tokensUsed: result.usage?.total_tokens,
  };
}

// ─── Public API ──────────────────────────────────────────────────

export function isAIAvailable(): boolean {
  return detectProvider() !== null;
}

export async function aiComplete(req: AICompletionRequest): Promise<AIResponse> {
  const provider = detectProvider();
  if (!provider) {
    throw new Error("No AI provider configured. Set OPENROUTER_API_KEY, GOOGLE_AI_API_KEY, or OPENAI_API_KEY.");
  }
  logger.debug({ provider }, "AI completion request");
  switch (provider) {
    case "openrouter": return openrouterComplete(req);
    case "gemini":     return geminiComplete(req);
    case "openai":     return openaiComplete(req);
  }
}

export async function aiCompleteWithProvider(
  provider: ProviderName,
  req: AICompletionRequest
): Promise<AIResponse> {
  switch (provider) {
    case "openrouter":
      if (!process.env.OPENROUTER_API_KEY) throw new Error("OpenRouter provider not configured");
      return openrouterComplete(req);
    case "gemini":
      if (!process.env.GOOGLE_AI_API_KEY) throw new Error("Gemini provider not configured");
      return geminiComplete(req);
    case "openai":
      if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI provider not configured");
      return openaiComplete(req);
  }
}

export async function aiVision(req: AIVisionRequest): Promise<AIResponse> {
  const provider = detectProvider();
  if (!provider) {
    throw new Error("No AI provider configured. Set OPENROUTER_API_KEY, GOOGLE_AI_API_KEY, or OPENAI_API_KEY.");
  }
  logger.debug({ provider }, "AI vision request");
  switch (provider) {
    case "openrouter": return openrouterVision(req);
    case "gemini":     return geminiVision(req);
    case "openai":     return openaiVision(req);
  }
}
