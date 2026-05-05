import { describe, expect, it } from "vitest";
import { resolveReplayLimit, toReplayPayload } from "../src/api/sse-utils.js";

describe("SSE replay utilities", () => {
  it("clamps and sanitizes replay limits", () => {
    expect(resolveReplayLimit(undefined, undefined)).toBe(100);
    expect(resolveReplayLimit("250", "100")).toBe(250);
    expect(resolveReplayLimit("2000", "100")).toBe(1000);
    expect(resolveReplayLimit("-2", "100")).toBe(0);
    expect(resolveReplayLimit("NaN", "50")).toBe(50);
  });

  it("formats replay rows as stream payload JSON", () => {
    const payload = toReplayPayload({
      id: "ev1",
      jobId: "job1",
      eventType: "page.crawled",
      url: "https://example.com",
      data: { statusCode: 200 },
      createdAt: "2026-05-05T00:00:00.000Z",
    });
    expect(JSON.parse(payload)).toEqual({
      id: "ev1",
      type: "page.crawled",
      jobId: "job1",
      url: "https://example.com",
      data: { statusCode: 200 },
      ts: "2026-05-05T00:00:00.000Z",
    });
  });
});

