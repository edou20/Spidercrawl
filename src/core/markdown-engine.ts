import TurndownService from "turndown";

// ── Singleton instance ───────────────────────────────────────────
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
  hr: "---",
});

// ── Custom Rules ─────────────────────────────────────────────────

// Preserve table structure (turndown strips tables by default)
turndown.addRule("table", {
  filter: "table",
  replacement(_content, node) {
    return "\n\n" + htmlTableToMarkdown(node) + "\n\n";
  },
});

// Convert <pre><code> blocks to fenced code blocks with lang hints
turndown.addRule("codeBlock", {
  filter(node) {
    return (
      node.nodeName === "PRE" &&
      node.firstChild !== null &&
      node.firstChild.nodeName === "CODE"
    );
  },
  replacement(_content, node) {
    const codeEl = node as unknown as { querySelector(s: string): { className?: string; textContent?: string } | null };
    const codeNode = codeEl.querySelector("code");
    if (!codeNode) return _content;
    const lang =
      codeNode.className?.replace("language-", "").split(" ")[0] || "";
    const code = codeNode.textContent || "";
    return `\n\n\`\`\`${lang}\n${code.trim()}\n\`\`\`\n\n`;
  },
});

// Strip images with tiny dimensions (tracking pixels, icons)
turndown.addRule("skipTinyImages", {
  filter(node) {
    if (node.nodeName !== "IMG") return false;
    const el = node as unknown as { getAttribute(s: string): string | null };
    const w = parseInt(el.getAttribute("width") || "999", 10);
    const h = parseInt(el.getAttribute("height") || "999", 10);
    return w < 20 || h < 20;
  },
  replacement() {
    return "";
  },
});

/**
 * Converts an HTML string to clean, LLM-optimised Markdown.
 */
export function toMarkdown(html: string): string {
  let md = turndown.turndown(html);

  // Post-processing: collapse excessive blank lines
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Converts an HTML <table> to a GitHub-Flavoured Markdown table.
 * Uses the Turndown Node interface (not full DOM HTMLElement).
 */
function htmlTableToMarkdown(tableNode: TurndownService.Node): string {
  const rows: string[][] = [];

  // Turndown nodes expose a minimal DOM-like interface
  const el = tableNode as unknown as {
    querySelectorAll(s: string): Array<{
      querySelectorAll(s: string): Array<{ textContent: string | null }>;
    }>;
  };

  const trElements = Array.from(el.querySelectorAll("tr"));
  trElements.forEach((tr: { querySelectorAll(s: string): ArrayLike<{ textContent: string | null }> }) => {
    const cells: string[] = [];
    Array.from(tr.querySelectorAll("th, td")).forEach((cell: { textContent: string | null }) => {
      cells.push((cell.textContent || "").trim().replace(/\|/g, "\\|"));
    });
    if (cells.length) rows.push(cells);
  });

  if (rows.length === 0) return "";

  const colCount = Math.max(...rows.map((r) => r.length));

  // Normalise all rows to same column count
  const normalised = rows.map((r) => {
    while (r.length < colCount) r.push("");
    return r;
  });

  const header = `| ${normalised[0].join(" | ")} |`;
  const separator = `| ${normalised[0].map(() => "---").join(" | ")} |`;
  const body = normalised
    .slice(1)
    .map((r) => `| ${r.join(" | ")} |`)
    .join("\n");

  return [header, separator, body].filter(Boolean).join("\n");
}
