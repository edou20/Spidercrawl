import { describe, expect, it } from "vitest";
import { buildRerunRequest } from "../dashboard/src/job-rerun.ts";

describe("buildRerunRequest", () => {
  it("preserves crawl configuration when creating a rerun request", () => {
    expect(buildRerunRequest("job_123", {
      rootUrl: "https://example.com",
      goal: "Find docs",
      maxDepth: 4,
      maxPages: 120,
      formats: ["markdown", "json"],
      extractionPrompt: "Extract titles",
      extractionSchema: { type: "object", properties: { title: { type: "string" } } },
      enableEntities: true,
      adaptiveBudget: true,
      satisfactionThreshold: 0.6,
    })).toEqual({
      url: "https://example.com",
      goal: "Find docs",
      maxDepth: 4,
      maxPages: 120,
      formats: ["markdown", "json"],
      extractionPrompt: "Extract titles",
      extractionSchema: { type: "object", properties: { title: { type: "string" } } },
      enableEntities: true,
      adaptiveBudget: true,
      satisfactionThreshold: 0.6,
      rerunJobId: "job_123",
    });
  });
});
