import * as cheerio from "cheerio";
import { logger } from "../lib/logger.js";
import type { MapRequest } from "../types/schemas.js";

interface SiteMap {
  rootUrl: string;
  totalLinks: number;
  pages: SiteMapNode[];
  discoveredAt: string;
}

interface SiteMapNode {
  url: string;
  title: string;
  depth: number;
  outLinks: string[];
}

/**
 * Discovers and returns the link topology of a site without
 * extracting full page content. Useful for pre-crawl analysis.
 */
export async function mapSite(req: MapRequest): Promise<SiteMap> {
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: req.url, depth: 0 }];
  const pages: SiteMapNode[] = [];

  const rootOrigin = new URL(req.url).origin;

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.url) || item.depth > req.maxDepth) continue;
    visited.add(item.url);

    try {
      const response = await fetch(item.url, {
        headers: {
          "User-Agent":
            "Spidercrawl-Mapper/0.1 (+https://github.com/spidercrawl)",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) continue;

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) continue;

      const html = await response.text();
      const $ = cheerio.load(html);

      const outLinks: string[] = [];
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
          const resolved = new URL(href, item.url).href;
          // Stay within the same domain
          if (resolved.startsWith(rootOrigin) && !visited.has(resolved)) {
            // Apply include/exclude patterns
            if (req.includePatterns?.length) {
              const matches = req.includePatterns.some((p) =>
                new RegExp(p).test(resolved)
              );
              if (!matches) return;
            }
            if (req.excludePatterns?.length) {
              const excluded = req.excludePatterns.some((p) =>
                new RegExp(p).test(resolved)
              );
              if (excluded) return;
            }

            outLinks.push(resolved);
            queue.push({ url: resolved, depth: item.depth + 1 });
          }
        } catch {
          // skip malformed
        }
      });

      pages.push({
        url: item.url,
        title: $("title").text().trim(),
        depth: item.depth,
        outLinks: [...new Set(outLinks)],
      });

      logger.debug(
        { url: item.url, depth: item.depth, links: outLinks.length },
        "Mapped page"
      );
    } catch (err) {
      logger.warn({ url: item.url, err }, "Map: failed to fetch");
    }
  }

  return {
    rootUrl: req.url,
    totalLinks: pages.reduce((sum, p) => sum + p.outLinks.length, 0),
    pages,
    discoveredAt: new Date().toISOString(),
  };
}
