import type { PageResult } from "../types/schemas.js";

export type EntityType =
  | "Article"
  | "Product"
  | "Organization"
  | "Person"
  | "Event"
  | "FAQPage"
  | "WebPage";

const KEYWORDS: Array<{ type: EntityType; patterns: RegExp[] }> = [
  { type: "Product", patterns: [/\bprice\b/i, /\badd to cart\b/i, /\bbuy now\b/i, /\bin stock\b/i] },
  { type: "Article", patterns: [/\bby\s+[A-Z][a-z]+/i, /\bpublished\b/i, /\bmin read\b/i, /<article/i] },
  { type: "Organization", patterns: [/\babout us\b/i, /\bour mission\b/i, /\bour team\b/i] },
  { type: "Person", patterns: [/\bbiography\b/i, /\bborn\b/i, /\bprofile\b/i] },
  { type: "Event", patterns: [/\bregister\b/i, /\bvenue\b/i, /\bschedule\b/i, /\bagenda\b/i] },
  { type: "FAQPage", patterns: [/\bfaq\b/i, /\bfrequently asked\b/i] },
];

export function detectEntityType(page: PageResult): EntityType {
  const haystack = `${page.title}\n${page.markdown?.slice(0, 2000) ?? ""}\n${page.html?.slice(0, 2000) ?? ""}`;
  let best: { type: EntityType; hits: number } = { type: "WebPage", hits: 0 };
  for (const { type, patterns } of KEYWORDS) {
    const hits = patterns.reduce((n, re) => n + (re.test(haystack) ? 1 : 0), 0);
    if (hits > best.hits) best = { type, hits };
  }
  return best.hits >= 2 ? best.type : "WebPage";
}

export function buildPageJsonLd(page: PageResult, entityType: EntityType): Record<string, unknown> {
  const base: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": entityType,
    "@id": page.url,
    url: page.url,
    name: page.title,
    description: page.metadata.description,
    inLanguage: page.metadata.language,
    image: page.metadata.ogImage,
    dateCrawled: page.metadata.crawledAt,
  };

  if (entityType === "Article") {
    base.headline = page.title;
    base.articleBody = page.markdown?.slice(0, 5000);
  }
  if (entityType === "Product" && page.extractedData) {
    Object.assign(base, {
      offers: {
        "@type": "Offer",
        price: page.extractedData.price,
        priceCurrency: page.extractedData.currency ?? "USD",
      },
    });
  }
  if (page.imageDescriptions?.length) {
    base.associatedMedia = page.imageDescriptions.map((img) => ({
      "@type": "ImageObject",
      contentUrl: img.src,
      description: img.description,
    }));
  }

  for (const k of Object.keys(base)) {
    if (base[k] === undefined || base[k] === null || base[k] === "") delete base[k];
  }
  return base;
}

export function buildGraphJsonLd(
  rootUrl: string,
  pages: Array<{ url: string; title?: string; entity_type?: string; jsonld?: Record<string, unknown> | null }>,
  links: Array<{ from: string; to: string }>
): Record<string, unknown> {
  const knownUrls = new Set(pages.map((p) => p.url));
  const nodes = pages.map((p) => {
    if (p.jsonld) return p.jsonld;
    return {
      "@context": "https://schema.org",
      "@type": p.entity_type ?? "WebPage",
      "@id": p.url,
      url: p.url,
      name: p.title,
    };
  });
  const edges = links
    .filter((l) => knownUrls.has(l.to))
    .map((l) => ({ "@type": "LinkRelationship", from: l.from, to: l.to }));

  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `Spidercrawl knowledge graph for ${rootUrl}`,
    url: rootUrl,
    dateCreated: new Date().toISOString(),
    "@graph": nodes,
    links: edges,
  };
}
