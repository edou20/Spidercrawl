import { getCrawlStatus } from "./orchestrator.js";
import { exportJobToRag } from "../export/rag.js";
import { logger } from "../lib/logger.js";
import type { PageResult } from "../types/schemas.js";

/**
 * Generates a JSON-LD Knowledge Graph representation of a completed crawl.
 * It builds a node for each page, links them together based on discovered URLs,
 * and incorporates extracted structured data and image descriptions.
 */
export async function generateJsonLdGraph(jobId: string) {
  const status = await getCrawlStatus(jobId);
  if (!status) throw new Error("Job not found");

  const nodes = status.results.map((page: PageResult) => {
    // Determine entity type from extracted data or fallback to WebPage
    const entityType = page.extractedData?.[ "@type" ] || page.extractedData?.type || "WebPage";

    // Gather links that exist within the crawl results to build edges
    const relatedLinks = page.links
      .filter((link) => status.results.some((r) => r.url === link))
      .map((link) => ({
        "@type": "LinkRole",
        to: link,
      }));

    return {
      "@context": "https://schema.org",
      "@type": entityType,
      "@id": page.url,
      url: page.url,
      name: page.title,
      description: page.metadata.description,
      language: page.metadata.language,
      dateModified: page.metadata.crawledAt,
      // Embed structured AI extraction directly into the JSON-LD node
      about: page.extractedData || undefined,
      // Embed vision AI descriptions
      image: page.imageDescriptions?.map((img) => ({
        "@type": "ImageObject",
        contentUrl: img.src,
        caption: img.description,
      })),
      // Edges to other crawled pages
      links: relatedLinks,
    };
  });

  logger.info({ jobId, nodes: nodes.length }, "Generated JSON-LD Knowledge Graph");

  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `Spidercrawl Knowledge Graph: ${jobId}`,
    dateCreated: new Date().toISOString(),
    hasPart: nodes,
  };
}

/**
 * Exports extracted embeddings/content to a Vector Database using the RAG export module.
 */
export async function exportToVectorDb(jobId: string) {
  try {
    const result = await exportJobToRag(jobId);
    logger.info({ jobId, pagesProcessed: result.pagesProcessed, chunksEmbedded: result.chunksEmbedded }, "Exported crawl to Vector Database via RAG");
    return {
      success: true,
      jobId,
      pagesProcessed: result.pagesProcessed,
      chunksEmbedded: result.chunksEmbedded,
      message: `Successfully exported to Vector Database: ${result.chunksEmbedded} chunks embedded`,
    };
  } catch (err: any) {
    logger.error({ err: err.message, jobId }, "Vector DB export failed");
    throw err;
  }
}
