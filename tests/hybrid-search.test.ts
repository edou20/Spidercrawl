import { describe, expect, it } from "vitest";
import { buildKeywordHitFromRow, mergeAndRerankHybridHits } from "../src/api/hybrid-search.js";

describe("hybrid search fallback behavior", () => {
  it("returns keyword-only results when vector hits are unavailable", () => {
    const keywordRows = [
      {
        url: "https://example.com/a",
        title: "Auth Docs",
        markdown: "Authentication and bearer token guide.",
        similarity: 2,
        status_code: 200,
        depth: 1,
        crawled_at: "2026-05-05T00:00:00.000Z",
      },
    ];
    const keywordHits = keywordRows.map((row) => buildKeywordHitFromRow(row, "authentication bearer", ["authentication", "bearer"], 2));
    const merged = mergeAndRerankHybridHits(keywordHits, [], "authentication bearer", 10);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.url).toBe("https://example.com/a");
    expect(merged[0]?.searchType).toBe("keyword");
    expect(merged[0]?.scoreBreakdown?.keyword).toBeDefined();
    expect(merged[0]?.scoreBreakdown?.rerank).toBeDefined();
  });

  it("upgrades to hybrid when keyword and vector overlap", () => {
    const keywordHit = buildKeywordHitFromRow(
      {
        url: "https://example.com/a",
        title: "Auth Docs",
        markdown: "Authentication and bearer token guide.",
        similarity: 2,
        status_code: 200,
        depth: 1,
        crawled_at: "2026-05-05T00:00:00.000Z",
      },
      "authentication bearer",
      ["authentication", "bearer"],
      2
    );

    const merged = mergeAndRerankHybridHits(
      [keywordHit],
      [{ url: "https://example.com/a", title: "Auth Docs", content: "Vector chunk", similarity: 0.91 }],
      "authentication bearer",
      10
    );

    expect(merged[0]?.searchType).toBe("hybrid");
    expect(merged[0]?.scoreBreakdown?.vector).toBe(0.91);
  });
});

