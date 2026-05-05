/**
 * Entity Resolver (Phase 1.4)
 * ============================
 * Extracts named entities from crawled page content and de-duplicates them
 * across the entire job, building a canonical entity list with source references.
 *
 * Supported entity types: Person, Organisation, Product, Location, Concept, Technology
 *
 * Algorithm:
 *  1. For each page, call the LLM to extract a structured entity list.
 *  2. Upsert each entity into the `entities` table — merging aliases and
 *     source URLs when a name+type collision is found (case-insensitive).
 *
 * The result is available via GET /v1/jobs/:id/entities.
 */

import { aiComplete, isAIAvailable } from "./provider.js";
import { upsertEntity, getJobPagesWithContent } from "../lib/job-store.js";
import { logger } from "../lib/logger.js";
import type { PageResult } from "../types/schemas.js";

export interface RawEntity {
  name: string;
  type: "Person" | "Organisation" | "Product" | "Location" | "Concept" | "Technology" | string;
  description?: string;
  aliases?: string[];
  confidence?: number;
}

/**
 * Extracts entities from a single page's content.
 */
async function extractEntitiesFromPage(
  content: string,
  url: string
): Promise<RawEntity[]> {
  if (!isAIAvailable() || !content.trim()) return [];

  const truncated = content.length > 8000 ? content.slice(0, 8000) : content;

  try {
    const result = await aiComplete({
      systemPrompt: `You are a named entity extractor. You identify real-world entities in text and classify them.

Entity types to extract:
- Person: Named individuals (authors, founders, executives, etc.)
- Organisation: Companies, institutions, agencies, non-profits
- Product: Software, hardware, services, tools (named products with a brand)
- Location: Countries, cities, regions, physical places
- Technology: Programming languages, frameworks, protocols, standards
- Concept: Important domain-specific concepts, methodologies, theories

Rules:
- Only extract entities that are clearly named (not generic terms)
- Each entity must have a unique canonical name (the most complete/formal form)
- Include common aliases or abbreviations in the aliases array
- Ignore entities that appear only once and are not significant
- Return an empty array if the page has no significant entities`,

      prompt: `Extract named entities from this web page content.

URL: ${url}

CONTENT:
${truncated}

Return a JSON array of entities. Each object must have:
- "name": canonical name (string)
- "type": one of Person, Organisation, Product, Location, Concept, Technology
- "description": one sentence description (string, optional)
- "aliases": alternative names or abbreviations (string array, may be empty)
- "confidence": confidence score between 0 and 1

Example:
[
  {"name": "OpenAI", "type": "Organisation", "description": "AI research company", "aliases": ["Open AI"], "confidence": 0.94},
  {"name": "GPT-4", "type": "Product", "description": "Large language model by OpenAI", "aliases": ["GPT4"], "confidence": 0.91}
]

Return ONLY the JSON array. No markdown fences.`,
      jsonMode: true,
      temperature: 0.05,
      maxTokens: 2048,
    });

    let parsed = JSON.parse(result.text);
    // Handle wrapped responses
    if (!Array.isArray(parsed)) {
      parsed = parsed.entities ?? parsed.results ?? [];
    }
    return (parsed as RawEntity[]).filter(
      (e) => e && typeof e.name === "string" && e.name.trim().length > 1
    );
  } catch (err: any) {
    logger.warn({ url, err: err.message }, "Entity extraction failed for page");
    return [];
  }
}

export interface EntityResolutionResult {
  jobId: string;
  pagesProcessed: number;
  entitiesFound: number;
  entitiesAfterMerge: number;
}

export async function resolveEntities(
  jobId: string,
  pages?: PageResult[],
  concurrency = 3
): Promise<EntityResolutionResult> {
  if (!isAIAvailable()) {
    throw new Error("Entity resolution requires an AI provider. Set GOOGLE_AI_API_KEY or OPENAI_API_KEY.");
  }

  const pagesToProcess = pages || await getJobPagesWithContent(jobId);

  let pagesProcessed = 0;
  let totalFound = 0;
  let totalUpserted = 0;

  // Process pages in batches to control concurrency and cost
  for (let i = 0; i < pagesToProcess.length; i += concurrency) {
    const batch = pagesToProcess.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async (page) => {
        const content = page.markdown ?? page.html ?? "";
        if (!content.trim()) return;

        const entities = await extractEntitiesFromPage(content, page.url);
        pagesProcessed++;
        totalFound += entities.length;

        for (const entity of entities) {
          const id = await upsertEntity(jobId, {
            name: entity.name.trim(),
            type: entity.type,
            description: entity.description,
            aliases: (entity.aliases ?? []).filter(Boolean),
            sourceUrls: [page.url],
            metadata: {
              confidence: typeof entity.confidence === "number" ? entity.confidence : 0.75,
              provenance: [{ url: page.url, extractedAt: new Date().toISOString() }],
            },
          });
          if (id) totalUpserted++;
        }
      })
    );

    logger.info(
      { jobId, batch: i / concurrency + 1, pagesProcessed, entitiesFound: totalFound },
      "Entity resolution batch complete"
    );
  }

  logger.info(
    { jobId, pagesProcessed, totalFound, totalUpserted },
    "Entity resolution complete"
  );

  return {
    jobId,
    pagesProcessed,
    entitiesFound: totalFound,
    entitiesAfterMerge: totalUpserted,
  };
}

export async function resolveEntitiesForPage(
  jobId: string,
  page: Pick<PageResult, "url" | "markdown" | "html">
): Promise<{ found: number; upserted: number }> {
  const content = page.markdown ?? page.html ?? "";
  if (!content.trim() || !isAIAvailable()) return { found: 0, upserted: 0 };

  const entities = await extractEntitiesFromPage(content, page.url);
  let upserted = 0;
  for (const entity of entities) {
    const id = await upsertEntity(jobId, {
      name: entity.name.trim(),
      type: entity.type,
      description: entity.description,
      aliases: (entity.aliases ?? []).filter(Boolean),
      sourceUrls: [page.url],
      metadata: {
        confidence: typeof entity.confidence === "number" ? entity.confidence : 0.75,
        provenance: [{ url: page.url, extractedAt: new Date().toISOString() }],
      },
    });
    if (id) upserted++;
  }
  return { found: entities.length, upserted };
}
