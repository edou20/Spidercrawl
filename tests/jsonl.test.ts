import { describe, expect, it } from "vitest";
import { jobToFineTuneJsonl, jobToJsonl } from "../src/export/jsonl.js";
import type { JobStatus, PageResult } from "../src/types/schemas.js";

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

function makeJob(results: PageResult[]): JobStatus {
  return {
    id: "job_123",
    rootUrl: "https://example.com",
    status: "completed",
    progress: 100,
    totalPages: results.length,
    completedPages: results.length,
    maxDepth: 3,
    maxPages: 50,
    results,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:05:00.000Z",
    goal: "Extract docs",
  };
}

describe("jobToJsonl", () => {
  it("emits one JSON object per page", () => {
    const jsonl = jobToJsonl(makeJob([
      makePage({ url: "https://example.com" }),
      makePage({ url: "https://example.com/docs", title: "Docs" }),
    ]));

    const lines = jsonl.split("\n");
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
    expect(() => JSON.parse(lines[1]!)).not.toThrow();
  });

  it("includes crawl metadata and persisted depth when provided", () => {
    const page = makePage({
      url: "https://example.com/docs/auth",
      title: "Authentication API",
      extractedData: { product: "Spidercrawl" },
      tables: [{ headers: ["Plan", "Price"], rows: [["Starter", "$9"]] }],
      imageDescriptions: [{ src: "a", alt: "", description: "", type: "diagram", confidence: 0.9 }],
    });

    const jsonl = jobToJsonl(
      makeJob([page]),
      new Map([[page.url, 4]])
    );

    const record = JSON.parse(jsonl);
    expect(record.job_id).toBe("job_123");
    expect(record.root_url).toBe("https://example.com");
    expect(record.depth).toBe(4);
    expect(record.goal).toBe("Extract docs");
    expect(record.tables).toEqual([{ headers: ["Plan", "Price"], rows: [["Starter", "$9"]] }]);
    expect(record.extracted_data).toEqual({ product: "Spidercrawl" });
    expect(record.image_descriptions).toHaveLength(1);
  });
});

describe("jobToFineTuneJsonl", () => {
  it("emits one chat-format training record per page", () => {
    const jsonl = jobToFineTuneJsonl(makeJob([
      makePage({
        url: "https://example.com/pricing",
        title: "Pricing",
        markdown: "Starter plan is $9 per month. Pro plan is $29 per month.",
        extractedData: { starter: 9, pro: 29 },
      }),
    ]));

    const record = JSON.parse(jsonl);
    expect(record.messages).toHaveLength(3);
    expect(record.messages[0].role).toBe("system");
    expect(record.messages[1].role).toBe("user");
    expect(record.messages[2].role).toBe("assistant");
    expect(record.metadata.url).toBe("https://example.com/pricing");
  });

  it("includes structured assistant payload with tables and summary", () => {
    const jsonl = jobToFineTuneJsonl(makeJob([
      makePage({
        markdown: "Spidercrawl extracts product tables from HTML pages for downstream AI workflows.",
        tables: [{ caption: "Plans", headers: ["Plan", "Price"], rows: [["Starter", "$9"]] }],
      }),
    ]));

    const record = JSON.parse(jsonl);
    const assistant = JSON.parse(record.messages[2].content);
    expect(assistant.summary).toContain("Spidercrawl extracts product tables");
    expect(assistant.tables).toEqual([
      { caption: "Plans", headers: ["Plan", "Price"], rows: [["Starter", "$9"]] },
    ]);
  });
});
