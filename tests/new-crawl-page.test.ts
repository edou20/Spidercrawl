import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "/Users/jssm/Documents/01_Projects/Spidercrawl/dashboard/src/pages/NewCrawlPage.tsx",
  "utf8"
);

describe("NewCrawlPage source", () => {
  it("wires the URL and goal labels to stable input ids", () => {
    expect(source).toContain('htmlFor="crawl-url"');
    expect(source).toContain('id="crawl-url"');
    expect(source).toContain('htmlFor="crawl-goal"');
    expect(source).toContain('id="crawl-goal"');
  });

  it("wires the extraction prompt label to its textarea id", () => {
    expect(source).toContain('htmlFor="crawl-extraction-prompt"');
    expect(source).toContain('id="crawl-extraction-prompt"');
  });
});
