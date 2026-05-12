import OpenAI from "openai";
import { getDb, isDbEnabled } from "../lib/db.js";
import { createOpenAIClient } from "../lib/openai-client.js";
import { logger } from "../lib/logger.js";
import { readIntegerEnv } from "../lib/env-utils.js";

const EMBED_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const EMBED_DIMS = readIntegerEnv("EMBEDDING_DIMENSIONS", 1536, { min: 1 });

// Target chunk size in characters (~375 tokens at ~4 chars/token).
// Smaller than 2048 means more chunks but better retrieval precision.
const CHUNK_MAX_CHARS = readIntegerEnv("CHUNK_MAX_CHARS", 1500, { min: 1 });

export interface RagExportResult {
  jobId: string;
  pagesProcessed: number;
  chunksEmbedded: number;
  model: string;
  dimensions: number;
}

/**
 * Splits text into semantically-coherent chunks suitable for embedding.
 *
 * Strategy (in order of priority):
 *  1. Split on paragraph boundaries (\n\n+) — preserves logical sections.
 *  2. If a paragraph exceeds CHUNK_MAX_CHARS, further split on sentence
 *     boundaries (. ! ?) so chunks never straddle logical units.
 *  3. Accumulate consecutive short paragraphs into one chunk until the
 *     size budget is exhausted, then start a new chunk.
 *
 * This ensures:
 *  - No chunk arbitrarily slices mid-sentence.
 *  - Retrieval hits return a complete thought, not half a sentence.
 */
function chunkText(text: string): string[] {
  if (!text) return [];

  // ── 1. Split into paragraphs ──────────────────────────────────
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (para.length > CHUNK_MAX_CHARS) {
      // ── 2. Oversized paragraph: flush current buffer, then split at sentences
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      // Split on sentence-ending punctuation followed by whitespace + capital letter
      // Uses a simple approach compatible with ES2018 (no lookbehind in older envs)
      const sentenceRe = /(?<=[.!?])\s+(?=[A-ZÀ-ž"'‘“])/;
      const sentences = para.split(sentenceRe);
      for (const sentence of sentences) {
        if ((current ? current + " " + sentence : sentence).length > CHUNK_MAX_CHARS && current) {
          chunks.push(current.trim());
          current = sentence;
        } else {
          current = current ? `${current} ${sentence}` : sentence;
        }
      }
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
    } else if (current && (current + "\n\n" + para).length > CHUNK_MAX_CHARS) {
      // ── 3. Adding this paragraph would exceed budget — flush and start fresh
      chunks.push(current.trim());
      current = para;
    } else {
      // ── Accumulate
      current = current ? `${current}\n\n${para}` : para;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 20); // drop fragments shorter than a sentence
}

async function embedBatch(client: OpenAI, inputs: string[]): Promise<number[][]> {
  const res = await client.embeddings.create({
    model: EMBED_MODEL,
    input: inputs,
  });
  return res.data.map((d) => d.embedding as number[]);
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function exportJobToRag(jobId: string): Promise<RagExportResult> {
  if (!isDbEnabled()) throw new Error("DATABASE_URL is not configured");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required for embeddings");

  const db = getDb();
  const client = createOpenAIClient();

  const pages = await db.query<{ id: string; url: string; title: string; markdown: string | null }>(
    `SELECT id, url, title, markdown FROM pages WHERE job_id = $1 AND markdown IS NOT NULL`,
    [jobId]
  );

  if (pages.rows.length === 0) {
    throw new Error(`No pages with markdown found for job ${jobId}`);
  }

  await db.query(`DELETE FROM embeddings WHERE job_id = $1`, [jobId]);

  let totalChunks = 0;
  for (const page of pages.rows) {
    const chunks = chunkText(page.markdown || "");
    if (chunks.length === 0) continue;

    const BATCH = 32;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      let vectors: number[][];
      try {
        vectors = await embedBatch(client, slice);
      } catch (err: any) {
        logger.error({ err: err.message, pageId: page.id }, "Embedding call failed");
        continue;
      }

      const rows = slice.map((content, idx) => ({
        content,
        vector: vectors[idx],
        chunkIndex: i + idx,
      }));

      const valuePlaceholders: string[] = [];
      const values: any[] = [];
      rows.forEach((r, j) => {
        const o = j * 6;
        valuePlaceholders.push(
          `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5}::vector,$${o + 6}::jsonb)`
        );
        values.push(
          jobId,
          page.id,
          r.chunkIndex,
          r.content,
          toVectorLiteral(r.vector),
          JSON.stringify({ url: page.url, title: page.title, jobId })
        );
      });

      await db.query(
        `INSERT INTO embeddings (job_id, page_id, chunk_index, content, embedding, metadata)
         VALUES ${valuePlaceholders.join(",")}`,
        values
      );
      totalChunks += rows.length;
    }
  }

  logger.info({ jobId, pages: pages.rows.length, chunks: totalChunks }, "RAG export completed");

  return {
    jobId,
    pagesProcessed: pages.rows.length,
    chunksEmbedded: totalChunks,
    model: EMBED_MODEL,
    dimensions: EMBED_DIMS,
  };
}

export async function searchEmbeddings(
  jobId: string,
  query: string,
  limit = 10
): Promise<Array<{ content: string; url: string; title: string; similarity: number; chunkIndex: number }>> {
  if (!isDbEnabled()) throw new Error("DATABASE_URL is not configured");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required");

  const client = createOpenAIClient();
  const [vec] = await embedBatch(client, [query]);
  const db = getDb();

  const res = await db.query<{ content: string; url: string; title: string; similarity: number; chunkIndex: number }>(
    `SELECT e.content,
            e.chunk_index AS "chunkIndex",
            (e.metadata->>'url') AS url,
            (e.metadata->>'title') AS title,
            1 - (e.embedding <=> $1::vector) AS similarity
     FROM embeddings e
     WHERE e.job_id = $2
     ORDER BY e.embedding <=> $1::vector
     LIMIT $3`,
    [toVectorLiteral(vec), jobId, limit]
  );

  return res.rows;
}
