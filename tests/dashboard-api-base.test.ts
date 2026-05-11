import { describe, expect, it } from "vitest";
import { joinApiUrl, resolveApiBaseUrl, resolveDocsUrl } from "../dashboard/src/api-base.ts";

describe("resolveApiBaseUrl", () => {
  it("prefers an explicit backend URL", () => {
    expect(resolveApiBaseUrl("http://127.0.0.1:5173", "http://127.0.0.1:3200/")).toBe("http://127.0.0.1:3200");
  });

  it("points local Vite dashboard snippets at the API port", () => {
    expect(resolveApiBaseUrl("http://127.0.0.1:5173")).toBe("http://127.0.0.1:3200");
    expect(resolveApiBaseUrl("http://localhost:5174/")).toBe("http://localhost:3200");
  });

  it("keeps the served app origin for built dashboard URLs", () => {
    expect(resolveApiBaseUrl("http://127.0.0.1:3200")).toBe("http://127.0.0.1:3200");
    expect(resolveApiBaseUrl("https://crawl.example.com")).toBe("https://crawl.example.com");
  });

  it("joins API paths onto the resolved backend origin", () => {
    expect(joinApiUrl("http://127.0.0.1:3200", "/v1/jobs")).toBe("http://127.0.0.1:3200/v1/jobs");
    expect(joinApiUrl("https://crawl.example.com/", "v1/stats")).toBe("https://crawl.example.com/v1/stats");
  });

  it("uses an explicit docs URL when configured and otherwise falls back to hosted docs", () => {
    expect(resolveDocsUrl("http://127.0.0.1:5173", "https://docs.example.com/guide")).toBe("https://docs.example.com/guide");
    expect(resolveDocsUrl("http://127.0.0.1:5173")).toBe("https://github.com/jssm/spidercrawl/tree/main/docs");
  });
});
