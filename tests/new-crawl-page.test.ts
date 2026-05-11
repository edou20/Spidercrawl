import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = fileURLToPath(new URL("../dashboard/src/pages/NewCrawlPage.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

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
