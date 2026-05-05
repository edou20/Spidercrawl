/**
 * Vision Processor
 * =================
 * Identifies significant images in scraped HTML and uses a Vision LLM
 * to generate semantic descriptions. These descriptions are embedded
 * directly into the Markdown output so LLMs "see" the full page context.
 */

import * as cheerio from "cheerio";
import { aiVision, isAIAvailable } from "./provider.js";
import { logger } from "../lib/logger.js";

export interface ImageDescription {
  src: string;
  alt: string;
  description: string;
  type: "photo" | "chart" | "diagram" | "infographic" | "icon" | "unknown";
  confidence: number;
}

/**
 * Scans HTML for significant images, sends them to a Vision LLM,
 * and returns semantic descriptions.
 */
export async function extractImageDescriptions(
  html: string,
  pageUrl: string,
  maxImages: number = 10
): Promise<ImageDescription[]> {
  if (!isAIAvailable()) {
    logger.warn("Vision processing skipped — no AI provider configured");
    return [];
  }

  const $ = cheerio.load(html);
  const candidates: { src: string; alt: string }[] = [];

  $("img").each((_, el) => {
    const src = $(el).attr("src");
    const alt = $(el).attr("alt") || "";
    const width = parseInt($(el).attr("width") || "0", 10);
    const height = parseInt($(el).attr("height") || "0", 10);

    if (!src) return;

    // Filter out tracking pixels, icons, and tiny images
    if (width > 0 && width < 50) return;
    if (height > 0 && height < 50) return;
    if (src.includes("data:image/gif")) return; // 1px tracking gifs
    if (src.includes("favicon")) return;
    if (src.includes("logo") && (width < 100 || height < 100)) return;

    // Resolve relative URLs
    let resolvedSrc = src;
    try {
      resolvedSrc = new URL(src, pageUrl).href;
    } catch {
      return; // Skip malformed URLs
    }

    candidates.push({ src: resolvedSrc, alt });
  });

  // Also detect <canvas> elements (charts rendered via JS)
  $("canvas").each((_, el) => {
    const id = $(el).attr("id") || "canvas";
    candidates.push({
      src: `[canvas#${id}]`,
      alt: $(el).attr("aria-label") || "Canvas element",
    });
  });

  // Limit to maxImages
  const toProcess = candidates.slice(0, maxImages);
  logger.info({ count: toProcess.length, total: candidates.length }, "Processing images for vision");

  const results: ImageDescription[] = [];

  for (const img of toProcess) {
    try {
      // Skip canvas elements (they need a screenshot, handled in Phase 3 worker)
      if (img.src.startsWith("[canvas")) {
        results.push({
          src: img.src,
          alt: img.alt,
          description: `[Canvas element: ${img.alt}. Full visual analysis requires Playwright worker.]`,
          type: "chart",
          confidence: 0.3,
        });
        continue;
      }

      // Fetch the image and convert to base64
      const imageResponse = await fetch(img.src, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!imageResponse.ok) continue;

      const contentType = imageResponse.headers.get("content-type") || "image/png";
      const buffer = await imageResponse.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      // Skip very small images (< 2KB is likely an icon)
      if (buffer.byteLength < 2048) continue;

      const visionResult = await aiVision({
        prompt: `Analyze this image from the webpage "${pageUrl}".

Provide a JSON response with these fields:
- "description": A detailed, semantic description of what this image shows (2-4 sentences). Include specific data, text, labels, or values visible in the image.
- "type": One of "photo", "chart", "diagram", "infographic", "icon", or "unknown"
- "confidence": A number 0-1 indicating how confident you are in your analysis

Context: The image alt text is "${img.alt}".`,
        imageBase64: base64,
        imageMimeType: contentType,
        jsonMode: true,
        temperature: 0.1,
        maxTokens: 512,
      });

      try {
        const parsed = JSON.parse(visionResult.text);
        results.push({
          src: img.src,
          alt: img.alt,
          description: parsed.description || "No description generated",
          type: parsed.type || "unknown",
          confidence: parsed.confidence ?? 0.5,
        });
        logger.debug({ src: img.src, type: parsed.type }, "Image described");
      } catch {
        results.push({
          src: img.src,
          alt: img.alt,
          description: visionResult.text.slice(0, 500),
          type: "unknown",
          confidence: 0.3,
        });
      }
    } catch (err: any) {
      logger.warn({ src: img.src, err: err.message }, "Vision processing failed for image");
    }
  }

  return results;
}

/**
 * Enriches a Markdown string by replacing image references with
 * AI-generated descriptions.
 */
export function enrichMarkdownWithVision(
  markdown: string,
  descriptions: ImageDescription[]
): string {
  let enriched = markdown;

  for (const desc of descriptions) {
    if (desc.confidence < 0.2) continue;

    // Find existing markdown image references and enhance them
    const escapedSrc = desc.src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const imgRegex = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedSrc}\\)`, "g");

    const replacement = `![${desc.alt}](${desc.src})\n> **🕷️ Spidercrawl Vision** [${desc.type}]: ${desc.description}`;

    if (imgRegex.test(enriched)) {
      enriched = enriched.replace(imgRegex, replacement);
    } else {
      // If the image wasn't in markdown (stripped by cleaner), append the description
      enriched += `\n\n> **🕷️ Spidercrawl Vision** [${desc.type}] (${desc.alt || desc.src}): ${desc.description}`;
    }
  }

  return enriched;
}
