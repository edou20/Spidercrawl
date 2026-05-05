import { describe, expect, it } from "vitest";
import { createSearchSnippet, enrichVectorSearchHits, keywordSearchAcrossJobs, keywordSearchPages, tokenizeSearchQuery } from "../src/export/search.js";
import type { PageResult } from "../src/types/schemas.js";

function makePage(overrides: Partial<PageResult> = {}): PageResult {
  return {
    url: "https://example.com",
    statusCode: 200,
    title: "Example Page",
    links: [],
    markdown: "Default content",
    metadata: {
      crawledAt: "2026-05-03T00:00:00.000Z",
      elapsedMs: 120,
    },
    ...overrides,
  };
}

describe("tokenizeSearchQuery", () => {
  it("deduplicates and drops short terms", () => {
    expect(tokenizeSearchQuery("API api an auth auth")).toEqual(["api", "auth"]);
  });
});

describe("createSearchSnippet", () => {
  it("centers the snippet around the first matching term when possible", () => {
    const text = "Intro words. Authentication begins here with tokens and sessions. More trailing detail after the match.";
    const snippet = createSearchSnippet(text, ["authentication"], 60);

    expect(snippet.toLowerCase()).toContain("authentication");
    expect(snippet.length).toBeLessThanOrEqual(61);
  });
});

describe("keywordSearchPages", () => {
  it("ranks title matches above body-only matches and returns enriched metadata", () => {
    const hits = keywordSearchPages([
      makePage({
        url: "https://example.com/docs/auth",
        title: "Authentication API",
        markdown: "This page explains sessions and bearer tokens.",
        metadata: {
          crawledAt: "2026-05-03T00:00:00.000Z",
          elapsedMs: 120,
          description: "Authentication reference",
        },
      }),
      makePage({
        url: "https://example.com/blog/post",
        title: "Engineering Blog",
        markdown: "Authentication appears in the middle of this article but not in the title.",
        metadata: {
          crawledAt: "2026-05-03T00:00:00.000Z",
          elapsedMs: 120,
          description: "Blog post",
        },
      }),
    ], "authentication", 5);

    expect(hits).toHaveLength(2);
    expect(hits[0]?.url).toBe("https://example.com/docs/auth");
    expect(hits[0]?.searchType).toBe("keyword");
    expect(hits[0]?.matchedTerms).toContain("authentication");
    expect(hits[0]?.description).toBe("Authentication reference");
    expect(hits[0]?.provenance.statusCode).toBe(200);
    expect(hits[0]?.similarity).toBeGreaterThan(hits[1]?.similarity ?? 0);
  });

  it("uses provided persisted page metadata for provenance", () => {
    const page = makePage({
      url: "https://example.com/docs/auth",
      title: "Authentication API",
      markdown: "Authentication reference and bearer token guidance.",
      metadata: {
        crawledAt: "2026-05-03T00:00:00.000Z",
        elapsedMs: 120,
        description: "Authentication reference",
      },
    });

    const hits = keywordSearchPages(
      [page],
      "authentication",
      5,
      new Map([[page.url, { depth: 4, statusCode: 202, crawledAt: "2026-05-03T01:02:03.000Z", imageCount: 3 }]])
    );

    expect(hits[0]?.provenance.depth).toBe(4);
    expect(hits[0]?.provenance.statusCode).toBe(202);
    expect(hits[0]?.provenance.crawledAt).toBe("2026-05-03T01:02:03.000Z");
    expect(hits[0]?.provenance.imageCount).toBe(3);
  });
});

describe("keywordSearchAcrossJobs", () => {
  it("returns job context for cross-job results", () => {
    const hits = keywordSearchAcrossJobs([
      {
        job: { id: "job_a", rootUrl: "https://docs.example.com", goal: "Find docs" },
        page: makePage({
          url: "https://docs.example.com/auth",
          title: "Authentication",
          markdown: "Bearer authentication setup and token rotation.",
        }),
        metadata: { depth: 2, statusCode: 200 },
      },
      {
        job: { id: "job_b", rootUrl: "https://shop.example.com" },
        page: makePage({
          url: "https://shop.example.com/pricing",
          title: "Pricing",
          markdown: "Plans and invoices.",
        }),
      },
    ], "authentication", 10);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.job?.id).toBe("job_a");
    expect(hits[0]?.provenance.depth).toBe(2);
    expect(hits[0]?.matchedTerms).toContain("authentication");
  });
});

describe("enrichVectorSearchHits", () => {
  it("preserves chunk provenance and page metadata for vector hits", () => {
    const page = makePage({
      url: "https://example.com/docs/auth",
      title: "Authentication API",
      markdown: "Bearer tokens and sessions are discussed here.",
      statusCode: 201,
      imageDescriptions: [{ src: "a", alt: "", description: "", type: "diagram", confidence: 0.9 }],
      metadata: {
        crawledAt: "2026-05-03T00:00:00.000Z",
        elapsedMs: 120,
        description: "Authentication reference",
      },
    });

    const hits = enrichVectorSearchHits([
      {
        url: page.url,
        title: page.title,
        content: "This chunk covers bearer token authentication and session handling in detail.",
        similarity: 0.8123,
        chunkIndex: 2,
      },
    ], new Map([[page.url, page]]), "bearer authentication", new Map([[page.url, { depth: 2 }]]));

    expect(hits).toHaveLength(1);
    expect(hits[0]?.searchType).toBe("vector");
    expect(hits[0]?.provenance.chunkIndex).toBe(2);
    expect(hits[0]?.provenance.depth).toBe(2);
    expect(hits[0]?.provenance.statusCode).toBe(201);
    expect(hits[0]?.provenance.imageCount).toBe(1);
    expect(hits[0]?.matchedTerms).toContain("bearer");
    expect(hits[0]?.description).toBe("Authentication reference");
  });
});
