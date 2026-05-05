/**
 * Structured Extractor
 * =====================
 * Uses an LLM to extract structured JSON data from page content
 * based on a user-defined schema or natural language prompt.
 */

import { aiComplete, aiCompleteWithProvider, detectProvider, getConfiguredProviders, isAIAvailable } from "./provider.js";
import { logger } from "../lib/logger.js";

interface ExtractionAttempt {
  provider: string;
  model?: string;
  ok: boolean;
  error?: string;
  tokensUsed?: number;
}

export interface StructuredExtractionDiagnostics {
  attempts: ExtractionAttempt[];
  usedFallbackProvider: boolean;
}

/**
 * Extracts structured data from page content using an LLM.
 *
 * @param content  - The page content (Markdown or HTML)
 * @param schema   - A JSON schema describing the desired output structure,
 *                   OR a natural language description of what to extract.
 * @param pageUrl  - The URL of the page (for context)
 */
export async function extractStructured(
  content: string,
  schema: Record<string, unknown> | string,
  pageUrl: string
): Promise<Record<string, unknown>> {
  const { data } = await extractStructuredDetailed(content, schema, pageUrl);
  return data;
}

export async function extractStructuredDetailed(
  content: string,
  schema: Record<string, unknown> | string,
  pageUrl: string
): Promise<{ data: Record<string, unknown>; diagnostics: StructuredExtractionDiagnostics }> {
  if (!isAIAvailable()) {
    throw new Error("Structured extraction requires an AI provider. Set GOOGLE_AI_API_KEY or OPENAI_API_KEY.");
  }

  const isJsonSchema = typeof schema === "object";

  const schemaInstruction = isJsonSchema
    ? `Extract data matching this JSON schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``
    : `Extract the following information: ${schema}`;

  // Truncate content to avoid token limits (keep first ~12K chars)
  const truncated = content.length > 12000
    ? content.slice(0, 12000) + "\n\n[... content truncated for processing ...]"
    : content;

  const completionRequest = {
    systemPrompt: `You are a precision data extraction engine. You receive web page content and a schema describing what data to extract. You MUST return valid JSON that matches the requested structure.

Rules:
- If a field is not found in the content, set it to null.
- If a field should be an array but only one item is found, return a single-element array.
- Extract exact values as they appear — do not paraphrase or summarize unless the schema asks for a summary.
- Dates should be in ISO 8601 format when possible.
- Currency values should include the currency symbol or code.`,

    prompt: `PAGE URL: ${pageUrl}

${schemaInstruction}

PAGE CONTENT:
${truncated}

Return ONLY valid JSON. Do not include markdown code fences or explanation.`,
    jsonMode: true,
    temperature: 0.05, // Very low for precision extraction
    maxTokens: 4096,
  };

  const attempts: ExtractionAttempt[] = [];
  const configured = getConfiguredProviders();
  const primary = detectProvider();
  const providerOrder = primary
    ? [primary, ...configured.filter((p) => p !== primary)]
    : configured;

  let usedFallbackProvider = false;
  let lastError = "Extraction failed";

  for (let pIndex = 0; pIndex < providerOrder.length; pIndex++) {
    const provider = providerOrder[pIndex];
    if (pIndex > 0) usedFallbackProvider = true;

    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex++) {
      try {
        const result = pIndex === 0 && attemptIndex === 0
          ? await aiComplete(completionRequest)
          : await aiCompleteWithProvider(provider, completionRequest);
        const extracted = JSON.parse(result.text);

        attempts.push({
          provider: result.provider,
          model: result.model,
          ok: true,
          tokensUsed: result.tokensUsed,
        });

        logger.info(
          {
            url: pageUrl,
            fields: Object.keys(extracted ?? {}).length,
            provider: result.provider,
            tokens: result.tokensUsed,
            attempts: attempts.length,
            usedFallbackProvider,
          },
          "Structured extraction complete"
        );
        return {
          data: extracted,
          diagnostics: { attempts, usedFallbackProvider },
        };
      } catch (err: any) {
        const message = err?.message || "Unknown extraction error";
        attempts.push({ provider, ok: false, error: message });
        lastError = message;

        // Retry same provider once only for transient provider errors.
        const transient = /(timeout|timed out|429|rate limit|503|temporar|overloaded|network|ECONN|fetch failed)/i.test(message);
        const canRetrySameProvider = transient && attemptIndex === 0;
        if (!canRetrySameProvider) break;
      }
    }
  }

  logger.error(
    { url: pageUrl, attempts, lastError },
    "Structured extraction failed after retries and provider fallback"
  );
  throw new Error(`Structured extraction failed: ${lastError}`);
}

/**
 * Extracts data from multiple pages and merges results.
 * Useful for crawl jobs where the same schema applies to all pages.
 */
export async function extractStructuredBatch(
  pages: Array<{ content: string; url: string }>,
  schema: Record<string, unknown> | string
): Promise<Array<{ url: string; data: Record<string, unknown>; error?: string }>> {
  const results: Array<{ url: string; data: Record<string, unknown>; error?: string }> = [];

  for (const page of pages) {
    try {
      const data = await extractStructured(page.content, schema, page.url);
      results.push({ url: page.url, data });
    } catch (err: any) {
      results.push({
        url: page.url,
        data: {},
        error: err.message,
      });
    }
  }

  return results;
}
