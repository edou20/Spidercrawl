import * as cheerio from "cheerio";
import crypto from "crypto";
import { toMarkdown } from "./markdown-engine.js";
import { extractTables } from "./table-extractor.js";
import { extractImageDescriptions, enrichMarkdownWithVision } from "../ai/vision-processor.js";
import { extractStructuredDetailed } from "../ai/structured-extractor.js";
import { logger } from "../lib/logger.js";
import type { ScrapeRequest, PageResult } from "../types/schemas.js";

// ── Configuration ──────────────────────────────────────────────
const WORKER_HOST = process.env.WORKER_HOST || "127.0.0.1";
const WORKER_PORT = process.env.WORKER_PORT || "8400";
const WORKER_URL = process.env.WORKER_URL || `http://${WORKER_HOST}:${WORKER_PORT}/scrape`;

/**
 * Scrapes a single page.
 *
 * Phase 1: Cheerio (fast, no JS rendering).
 * Phase 2: Vision LLM + Structured extraction.
 * Phase 3: Playwright worker + Self-Healing extraction.
 */
export async function scrapePage(req: ScrapeRequest, isRetry = false): Promise<PageResult> {
  const start = Date.now();
  let html = "";
  let responseStatus = 200;
  let screenshot: string | undefined;

  const needsBrowser = req.useBrowser || req.formats.includes("screenshot") || isRetry;

  try {
    if (needsBrowser) {
      // ── Phase 3: Playwright Worker ────────────────────────
      logger.debug({ url: req.url }, "Fetching via Playwright worker");
      const workerRes = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: req.url,
          waitFor: req.waitFor ?? 2000,
          timeout: req.timeout,
          proxyUrl: req.proxyUrl, // Phase 3: Advanced Stealth
        }),
      });

      if (!workerRes.ok) {
        throw new Error(`Worker failed: ${workerRes.statusText}`);
      }

      const data = await workerRes.json() as any;
      if (data.error) throw new Error(`Worker error: ${data.error}`);

      html = data.html;
      if (req.formats.includes("screenshot")) {
        screenshot = data.screenshot;
      }
    } else {
      // ── Phase 1: Fast Cheerio Fetch ────────────────────────
      logger.debug({ url: req.url }, "Fetching via fast HTTP");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeout);
      
      try {
        const response = await fetch(req.url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            ...req.headers,
          },
        });
        responseStatus = response.status;
        html = await response.text();
      } finally {
        clearTimeout(timer);
      }
    }

    const $ = cheerio.load(html);

    // ── Strip unwanted elements ──────────────────────────────
    const defaultExclude = [
      "script", "style", "noscript", "iframe", "svg",
      "nav", "footer", "header",
      "[role='navigation']", "[role='banner']", "[role='contentinfo']",
      ".cookie-banner", ".ad", ".advertisement", ".popup",
    ];
    const excludes = req.excludeTags ?? defaultExclude;
    excludes.forEach((sel) => $(sel).remove());

    let contentHtml: string;
    let contentScope: cheerio.Cheerio<any> | undefined;
    if (req.includeTags && req.includeTags.length > 0) {
      contentScope = $(req.includeTags.join(","));
      contentHtml = req.includeTags.map((sel) => $(sel).html() || "").join("\n");
    } else {
      contentScope = $("main").first();
      if (contentScope.length === 0) contentScope = $("article").first();
      if (contentScope.length === 0) contentScope = $("body").first();
      contentHtml = contentScope.html() || html;
    }

    // ── Extract links ────────────────────────────────────────
    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        try {
          const resolved = new URL(href, req.url).href;
          if (resolved.startsWith("http")) links.push(resolved);
        } catch { /* skip */ }
      }
    });

    // ── Build partial result ─────────────────────────────────
    const result: PageResult = {
      url: req.url,
      statusCode: responseStatus,
      title: $("title").text().trim() || "",
      links: [...new Set(links)],
      screenshot,
      metadata: {
        description: $('meta[name="description"]').attr("content") || undefined,
        language: $("html").attr("lang") || undefined,
        ogImage: $('meta[property="og:image"]').attr("content") || undefined,
        crawledAt: new Date().toISOString(),
        elapsedMs: 0, // finalized later
      },
    };

    const tables = extractTables($, contentScope);
    if (tables.length > 0) {
      result.tables = tables;
    }

    if (req.formats.includes("markdown")) {
      result.markdown = toMarkdown(contentHtml);
    }
    if (req.formats.includes("html")) {
      result.html = contentHtml;
    }
    if (req.formats.includes("json")) {
      result.json = {
        tables: result.tables ?? [],
      };
    }

    // ── Phase 1.3: Change Detection Hash ─────────────────────
    const hashSource = result.markdown || contentHtml || "";
    const contentHash = crypto.createHash("sha256").update(hashSource).digest("hex");
    result.contentHash = contentHash;

    if (req.previousHash === contentHash) {
      logger.info({ url: req.url, contentHash }, "Content unchanged, skipping extraction phase");
      result.unchanged = true;
      result.metadata.elapsedMs = Date.now() - start;
      return result;
    }

    // ── Phase 2: Vision LLM ─────────────────────────────────
    if (req.enableVision) {
      try {
        const descriptions = await extractImageDescriptions(html, req.url);
        if (descriptions.length > 0) {
          result.imageDescriptions = descriptions;
          if (result.markdown) {
            result.markdown = enrichMarkdownWithVision(result.markdown, descriptions);
          }
          logger.info({ url: req.url, images: descriptions.length }, "Vision processing complete");
        }
      } catch (err: any) {
        logger.warn({ url: req.url, err: err.message }, "Vision processing failed (non-fatal)");
      }
    }

    // ── Phase 2 & 3: Structured Extraction & Self-Healing ───
    if (req.extractSchema || req.extractPrompt) {
      try {
        const contentForExtraction = result.markdown || contentHtml;
        const schema = req.extractSchema || req.extractPrompt!;
        const { data: extracted, diagnostics } = await extractStructuredDetailed(contentForExtraction, schema, req.url);

        // If extraction succeeded but looks mostly empty, deep-inspect via browser.
        if (!needsBrowser && !isRetry && isExtractionEmpty(extracted)) {
          logger.warn(
            { url: req.url, attempts: diagnostics.attempts.length },
            "Extraction mostly empty — triggering Self-Healing with Playwright"
          );
          return await scrapePage(req, true);
        }

        result.extractedData = extracted;
        if (req.formats.includes("json")) {
          result.json = {
            ...(result.json ?? {}),
            extractedData: result.extractedData,
            extractionDiagnostics: diagnostics,
          };
        }
        logger.info(
          {
            url: req.url,
            selfHealed: isRetry,
            extractionAttempts: diagnostics.attempts.length,
            usedFallbackProvider: diagnostics.usedFallbackProvider,
          },
          "Structured extraction complete"
        );
      } catch (err: any) {
        // Provider/model errors can often be healed by deep inspect mode (rendered page + fresh extraction).
        if (!needsBrowser && !isRetry) {
          logger.warn(
            { url: req.url, err: err.message },
            "Structured extraction failed — triggering Self-Healing with Playwright"
          );
          return await scrapePage(req, true);
        }
        logger.warn({ url: req.url, err: err.message, selfHealed: isRetry }, "Structured extraction failed (non-fatal)");
      }
    }

    result.metadata.elapsedMs = Date.now() - start;
    logger.info(
      { url: req.url, status: responseStatus, ms: result.metadata.elapsedMs, browser: needsBrowser },
      "Scrape complete"
    );

    return result;

  } catch (err: any) {
    logger.error({ url: req.url, err: err.message }, "Scrape error");
    throw err;
  }
}

/**
 * Heuristic to determine if an extracted JSON object is mostly empty or null.
 * If 70% or more of its top-level keys are null or empty strings/arrays, consider it empty.
 */
function isExtractionEmpty(data: Record<string, unknown>): boolean {
  const keys = Object.keys(data);
  if (keys.length === 0) return true;

  let emptyCount = 0;
  for (const key of keys) {
    const val = data[key];
    if (
      val === null ||
      val === undefined ||
      val === "" ||
      (Array.isArray(val) && val.length === 0)
    ) {
      emptyCount++;
    }
  }

  return (emptyCount / keys.length) >= 0.7;
}
