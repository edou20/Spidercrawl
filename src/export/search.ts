import { detectEntityType } from "./jsonld.js";
import type { PageResult, SearchHit } from "../types/schemas.js";

export type SearchType = "vector" | "keyword";

export interface SearchPageMetadata {
  depth?: number;
  statusCode?: number;
  crawledAt?: string;
  imageCount?: number;
}

export interface RawSearchHit {
  url: string;
  title?: string;
  content: string;
  similarity: number;
  chunkIndex?: number;
}

export interface SearchPageEntry {
  job: {
    id: string;
    rootUrl: string;
    goal?: string;
  };
  page: PageResult;
  metadata?: SearchPageMetadata;
}

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tokenizeSearchQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 2)
    )
  );
}

export function extractMatchedTerms(text: string, terms: string[]): string[] {
  const haystack = text.toLowerCase();
  return terms.filter((term) => haystack.includes(term));
}

export function createSearchSnippet(text: string, terms: string[], maxChars = 320): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;

  const lower = normalized.toLowerCase();
  const firstMatchIndex = terms
    .map((term) => lower.indexOf(term))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0];

  if (firstMatchIndex === undefined) {
    return normalized.slice(0, maxChars).trimEnd() + "…";
  }

  const contextRadius = Math.floor(maxChars / 2);
  const start = Math.max(0, firstMatchIndex - contextRadius);
  const end = Math.min(normalized.length, start + maxChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";

  return `${prefix}${normalized.slice(start, end).trim()}${suffix}`;
}

export function formatSearchHit(
  hit: RawSearchHit,
  searchType: SearchType,
  page?: PageResult,
  matchedTerms: string[] = [],
  pageMetadata?: SearchPageMetadata
): SearchHit {
  const content = hit.content.trim();

  return {
    url: hit.url,
    title: hit.title?.trim() || page?.title || hit.url,
    content,
    similarity: parseFloat(Math.min(0.99, hit.similarity).toFixed(2)),
    searchType,
    description: page?.metadata.description,
    entityType: page ? detectEntityType(page) : undefined,
    matchedTerms,
    provenance: {
      chunkIndex: hit.chunkIndex,
      depth: pageMetadata?.depth,
      statusCode: pageMetadata?.statusCode ?? page?.statusCode,
      crawledAt: pageMetadata?.crawledAt ?? page?.metadata.crawledAt,
      imageCount: pageMetadata?.imageCount ?? page?.imageDescriptions?.length,
    },
  };
}

export function keywordSearchPages(
  pages: PageResult[],
  query: string,
  limit = 8,
  pageMetadataByUrl?: Map<string, SearchPageMetadata>
): SearchHit[] {
  const terms = tokenizeSearchQuery(query);
  if (terms.length === 0) return [];

  const scored = pages
    .filter((page) => page.markdown || page.title)
    .map((page) => {
      const searchableText = `${page.title} ${page.metadata.description ?? ""} ${page.markdown ?? ""}`;
      const lower = searchableText.toLowerCase();
      let score = 0;

      for (const term of terms) {
        const re = new RegExp(escapeRegex(term), "g");
        score += (lower.match(re) ?? []).length;
        if ((page.title ?? "").toLowerCase().includes(term)) score += 5;
      }

      return { page, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const maxScore = scored[0]?.score ?? 1;

  return scored.map(({ page, score }) =>
    formatSearchHit(
      {
        url: page.url,
        title: page.title,
        content: createSearchSnippet(page.markdown ?? page.html ?? "", terms),
        similarity: score / maxScore,
      },
      "keyword",
      page,
      extractMatchedTerms(`${page.title} ${page.metadata.description ?? ""} ${page.markdown ?? ""}`.toLowerCase(), terms),
      pageMetadataByUrl?.get(page.url)
    )
  );
}

export function keywordSearchAcrossJobs(
  entries: SearchPageEntry[],
  query: string,
  limit = 12
): SearchHit[] {
  const terms = tokenizeSearchQuery(query);
  if (terms.length === 0) return [];

  const scored = entries
    .filter(({ page }) => page.markdown || page.title)
    .map((entry) => {
      const searchableText = `${entry.page.title} ${entry.page.metadata.description ?? ""} ${entry.page.markdown ?? ""}`;
      const lower = searchableText.toLowerCase();
      let score = 0;

      for (const term of terms) {
        const re = new RegExp(escapeRegex(term), "g");
        score += (lower.match(re) ?? []).length;
        if ((entry.page.title ?? "").toLowerCase().includes(term)) score += 5;
        if ((entry.job.rootUrl ?? "").toLowerCase().includes(term)) score += 2;
      }

      return { ...entry, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const maxScore = scored[0]?.score ?? 1;

  return scored.map(({ job, page, metadata, score }) => ({
    ...formatSearchHit(
      {
        url: page.url,
        title: page.title,
        content: createSearchSnippet(page.markdown ?? page.html ?? "", terms),
        similarity: score / maxScore,
      },
      "keyword",
      page,
      extractMatchedTerms(`${page.title} ${page.metadata.description ?? ""} ${page.markdown ?? ""}`.toLowerCase(), terms),
      metadata
    ),
    job,
  }));
}

export function enrichVectorSearchHits(
  hits: RawSearchHit[],
  pagesByUrl: Map<string, PageResult>,
  query: string,
  pageMetadataByUrl?: Map<string, SearchPageMetadata>
): SearchHit[] {
  const terms = tokenizeSearchQuery(query);
  return hits.map((hit) => {
    const page = pagesByUrl.get(hit.url);
    return formatSearchHit(
      {
        ...hit,
        content: createSearchSnippet(hit.content, terms),
      },
      "vector",
      page,
      extractMatchedTerms(`${hit.title ?? ""} ${hit.content}`.toLowerCase(), terms),
      pageMetadataByUrl?.get(hit.url)
    );
  });
}
