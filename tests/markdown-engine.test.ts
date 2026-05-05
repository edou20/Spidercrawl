import { describe, expect, it } from "vitest";
import { toMarkdown } from "../src/core/markdown-engine.js";

describe("toMarkdown", () => {
  it("converts tables when DOM collections do not expose forEach", () => {
    const markdown = toMarkdown(`
      <table>
        <tr><th>Plan</th><th>Price</th></tr>
        <tr><td>Starter</td><td>$9</td></tr>
      </table>
    `);

    expect(markdown).toContain("| Plan | Price |");
    expect(markdown).toContain("| --- | --- |");
    expect(markdown).toContain("| Starter | $9 |");
  });
});
