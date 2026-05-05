import { describe, expect, it } from "vitest";
import { normalizeApiPayload } from "../src/api/serialize.js";

describe("normalizeApiPayload", () => {
  it("converts nested snake_case keys to camelCase", () => {
    const input = {
      success: true,
      data: {
        root_url: "https://example.com",
        completed_pages: 10,
        page_rows: [
          {
            status_code: 200,
            entity_type: "Article",
            metadata: { crawled_at: "2026-05-05T00:00:00.000Z" },
          },
        ],
      },
    };

    expect(normalizeApiPayload(input)).toEqual({
      success: true,
      data: {
        rootUrl: "https://example.com",
        completedPages: 10,
        pageRows: [
          {
            statusCode: 200,
            entityType: "Article",
            metadata: { crawledAt: "2026-05-05T00:00:00.000Z" },
          },
        ],
      },
    });
  });

  it("leaves already-camelCase and special keys intact", () => {
    const input = {
      alreadyCamel: true,
      "@context": "https://schema.org",
      mixed_value: 42,
    };

    expect(normalizeApiPayload(input)).toEqual({
      alreadyCamel: true,
      "@context": "https://schema.org",
      mixedValue: 42,
    });
  });
});

