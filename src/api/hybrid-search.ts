import { createSearchSnippet, extractMatchedTerms, tokenizeSearchQuery } from "../export/search.js";

export interface HybridHit {
  url: string;
  title?: string;
  content: string;
  similarity: number;
  searchType: "keyword" | "vector" | "hybrid";
  matchedTerms: string[];
  provenance?: {
    depth?: number;
    statusCode?: number;
    crawledAt?: string;
  };
  scoreBreakdown?: {
    keyword?: number;
    vector?: number;
    rerank?: number;
  };
}

export function lexicalScore(text: string, terms: string[]): number {
  if (!terms.length) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of terms) if (lower.includes(term)) score += 1;
  return score / terms.length;
}

export function rerankHybridHit(hit: HybridHit, terms: string[]): number {
  const lex = lexicalScore(`${hit.title ?? ""} ${hit.content ?? ""}`, terms);
  const kw = typeof hit.scoreBreakdown?.keyword === "number" ? hit.scoreBreakdown.keyword : 0;
  const vec = typeof hit.scoreBreakdown?.vector === "number" ? hit.scoreBreakdown.vector : 0;
  return (lex * 0.5) + (kw * 0.3) + (vec * 0.2);
}

export function buildKeywordHitFromRow(row: any, query: string, terms: string[], divisor: number): HybridHit {
  const keywordScore = Number(row.similarity) / Math.max(1, divisor);
  return {
    url: row.url,
    title: row.title,
    content: createSearchSnippet(row.markdown ?? "", terms.length ? terms : [query.toLowerCase()]),
    similarity: keywordScore,
    searchType: "keyword",
    matchedTerms: extractMatchedTerms(`${row.title ?? ""} ${row.markdown ?? ""}`.toLowerCase(), terms),
    provenance: {
      depth: row.depth ?? undefined,
      statusCode: row.status_code ?? undefined,
      crawledAt: row.crawled_at ? new Date(row.crawled_at).toISOString() : undefined,
    },
    scoreBreakdown: { keyword: keywordScore },
  };
}

export function mergeAndRerankHybridHits(
  keywordHits: HybridHit[],
  vectorHits: Array<{ url: string; title?: string; content: string; similarity: number }>,
  query: string,
  limit: number
): HybridHit[] {
  const terms = tokenizeSearchQuery(query);
  const merged = new Map<string, HybridHit>();

  for (const hit of keywordHits) merged.set(hit.url, hit);

  for (const row of vectorHits) {
    const existing = merged.get(row.url);
    if (!existing) {
      merged.set(row.url, {
        ...row,
        searchType: "vector",
        matchedTerms: extractMatchedTerms(`${row.title ?? ""} ${row.content ?? ""}`.toLowerCase(), terms),
        scoreBreakdown: { vector: row.similarity },
      });
      continue;
    }
    merged.set(row.url, {
      ...existing,
      similarity: Math.max(existing.similarity ?? 0, row.similarity ?? 0),
      searchType: "hybrid",
      content: existing.content || row.content,
      scoreBreakdown: {
        keyword: existing.scoreBreakdown?.keyword,
        vector: row.similarity,
      },
    });
  }

  return [...merged.values()]
    .map((hit) => {
      const rerank = rerankHybridHit(hit, terms);
      return {
        ...hit,
        similarity: rerank,
        scoreBreakdown: { ...(hit.scoreBreakdown ?? {}), rerank },
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

