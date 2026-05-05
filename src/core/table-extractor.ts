import type * as cheerio from "cheerio";
import type { PageResult } from "../types/schemas.js";

type ExtractedTable = NonNullable<PageResult["tables"]>[number];

function cleanCellText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function extractTables($: cheerio.CheerioAPI, scope?: cheerio.Cheerio<any>): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  const tableElements = scope ? scope.find("table") : $("table");

  tableElements.each((_, tableEl) => {
    const table = $(tableEl);
    const caption = cleanCellText(table.find("caption").first().text());

    const rowElements = table.find("tr").toArray();
    const parsedRows = rowElements
      .map((rowEl) => {
        const row = $(rowEl);
        const cells = row.find("th, td").toArray().map((cellEl) => cleanCellText($(cellEl).text()));
        const headerCells = row.find("th").toArray().map((cellEl) => cleanCellText($(cellEl).text()));
        return {
          cells: cells.filter((cell) => cell.length > 0),
          headerCells: headerCells.filter((cell) => cell.length > 0),
          allHeader: row.find("td").length === 0 && headerCells.length > 0,
        };
      })
      .filter((row) => row.cells.length > 0);

    if (parsedRows.length === 0) return;

    const headerRow = parsedRows.find((row) => row.allHeader) ?? parsedRows[0];
    const headers = headerRow.headerCells.length > 0 ? headerRow.headerCells : headerRow.cells;
    const bodyRows = parsedRows
      .filter((row) => row !== headerRow)
      .map((row) => row.cells);

    if (headers.length === 0 && bodyRows.length === 0) return;

    tables.push({
      caption: caption || undefined,
      headers,
      rows: bodyRows,
    });
  });

  return tables;
}
