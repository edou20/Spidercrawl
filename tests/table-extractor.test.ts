import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { extractTables } from "../src/core/table-extractor.js";

describe("extractTables", () => {
  it("extracts headers, rows, and captions from standard tables", () => {
    const $ = cheerio.load(`
      <main>
        <table>
          <caption>Pricing</caption>
          <thead>
            <tr><th>Plan</th><th>Price</th></tr>
          </thead>
          <tbody>
            <tr><td>Starter</td><td>$9</td></tr>
            <tr><td>Pro</td><td>$29</td></tr>
          </tbody>
        </table>
      </main>
    `);

    const tables = extractTables($, $("main"));

    expect(tables).toHaveLength(1);
    expect(tables[0]).toEqual({
      caption: "Pricing",
      headers: ["Plan", "Price"],
      rows: [["Starter", "$9"], ["Pro", "$29"]],
    });
  });

  it("falls back to the first row as headers when no thead exists", () => {
    const $ = cheerio.load(`
      <body>
        <table>
          <tr><td>Quarter</td><td>Revenue</td></tr>
          <tr><td>Q1</td><td>$100k</td></tr>
        </table>
      </body>
    `);

    const tables = extractTables($);

    expect(tables[0]?.headers).toEqual(["Quarter", "Revenue"]);
    expect(tables[0]?.rows).toEqual([["Q1", "$100k"]]);
  });
});
