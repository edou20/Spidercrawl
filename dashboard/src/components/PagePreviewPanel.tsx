import { useState, useEffect } from "react";
import { ExternalLink, FileText, Code, Table, Image, Link2, ChevronRight } from "lucide-react";
import type { PageRow } from "../api";
import LoadingSpinner from "./LoadingSpinner";

interface Props {
  page: PageRow | null;
  loading?: boolean;
  onSelectUrl?: (url: string) => void;
}

type PreviewTab = "markdown" | "json" | "tables" | "images" | "links";

export default function PagePreviewPanel({ page, loading, onSelectUrl }: Props) {
  const [tab, setTab] = useState<PreviewTab>("markdown");

  // When a new page loads, auto-select the most valuable tab
  useEffect(() => {
    if (!page) return;
    const hasData = !!page.extractedData && Object.keys(page.extractedData).length > 0;
    setTab(hasData ? "json" : "markdown");
  }, [page?.url]);

  if (loading) {
    return (
      <div className="preview-panel preview-panel--loading">
        <LoadingSpinner loading />
        <span className="text-sm text-tertiary" style={{ marginLeft: 10 }}>Loading page content…</span>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="preview-panel preview-panel--empty">
        <FileText size={32} style={{ opacity: 0.2 }} />
        <p className="text-sm text-tertiary" style={{ marginTop: 10 }}>
          Click a page row to preview its content
        </p>
      </div>
    );
  }

  const hasJson = !!page.extractedData && Object.keys(page.extractedData).length > 0;
  const hasTables = Array.isArray(page.tables) && page.tables.length > 0;
  const hasImages = Array.isArray(page.imageDescriptions) && page.imageDescriptions.length > 0;
  const hasLinks = Array.isArray(page.links) && page.links.length > 0;

  const tabs: { id: PreviewTab; icon: any; label: string; count?: number; title: string }[] = [
    { id: "markdown", icon: FileText, label: "Markdown", title: "Clean text extracted from the page." },
    { id: "json",     icon: Code,     label: "Extracted data", title: "Structured JSON produced by an extraction prompt or schema." },
    { id: "tables",   icon: Table,    label: "Tables",     count: page.tables?.length ?? 0, title: "HTML tables found on this page." },
    { id: "images",   icon: Image,    label: "Images",     count: page.imageDescriptions?.length ?? 0, title: "AI image descriptions, available when vision is enabled." },
    { id: "links",    icon: Link2,    label: "Links",      count: page.links?.length ?? 0, title: "Links discovered on this page." },
  ];

  return (
    <div className="preview-panel">
      {/* Page header */}
      <div className="preview-header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="preview-title">{page.title || page.url}</div>
          <div className="preview-url font-mono text-xs text-tertiary truncate">{page.url}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`badge badge-${page.statusCode >= 400 ? "failed" : page.statusCode >= 300 ? "queued" : "completed"}`}>
            {page.statusCode}
          </span>
          {page.depth !== null && (
            <span className="text-xs text-disabled font-mono">depth {page.depth}</span>
          )}
          <a href={page.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm btn-icon">
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="preview-tabs">
        {tabs.map(({ id, icon: Icon, label, count, title }) => (
          <button
            key={id}
            className={`preview-tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
            title={title}
          >
            <Icon size={11} />
            {label}
            {count !== undefined && (
              <span className="preview-tab-count">{count}</span>
            )}
          </button>
        ))}
      </div>
      <div className="preview-tab-help">
        Each tab shows a different kind of data from the selected page. A count of 0 means that page did not produce that data.
      </div>

      {/* Content */}
      <div className="preview-content">
        {tab === "markdown" && (
          <pre className="preview-markdown">
            {page.markdown
              ? page.markdown.slice(0, 8000) + (page.markdown.length > 8000 ? "\n\n… (truncated)" : "")
              : <span className="text-tertiary text-xs">No markdown content</span>
            }
          </pre>
        )}

        {tab === "json" && (
          hasJson ? (
            <pre className="preview-json">
              {JSON.stringify(page.extractedData, null, 2)}
            </pre>
          ) : (
            <PreviewEmpty
              icon={Code}
              title="No structured data for this page"
              body="This page was not crawled with an extraction prompt/schema, or the extractor did not find structured fields. Use Re-run Extraction on the job if you want JSON fields."
            />
          )
        )}

        {tab === "tables" && (
          hasTables ? (
            <div className="preview-tables-list">
              {page.tables!.map((tbl, ti) => (
                <div key={ti} className="preview-table-wrap">
                  <div className="preview-table-label">Table {ti + 1}</div>
                  <div className="table-wrap">
                    <table>
                      {tbl.headers.length > 0 && (
                        <thead>
                          <tr>{tbl.headers.map((h, hi) => <th key={hi}>{h}</th>)}</tr>
                        </thead>
                      )}
                      <tbody>
                        {tbl.rows.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => <td key={ci}>{cell}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <PreviewEmpty icon={Table} title="No tables found" body="Spidercrawl did not detect any HTML tables on this page." />
          )
        )}

        {tab === "images" && (
          hasImages ? (
            <div className="preview-images-list">
              {page.imageDescriptions!.map((desc, i) => (
                <div key={i} className="preview-image-item">
                  <div className="preview-image-index">
                    <Image size={11} />
                    Image {i + 1}
                    <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.6, textTransform: "uppercase" }}>
                      {desc.type}
                    </span>
                  </div>
                  {desc.src && !desc.src.startsWith("[canvas") && (
                    <img
                      src={desc.src}
                      alt={desc.alt || ""}
                      style={{ maxWidth: "100%", maxHeight: 180, borderRadius: 6, marginBottom: 8, objectFit: "contain" }}
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  <p className="text-sm text-secondary">{desc.description}</p>
                </div>
              ))}
            </div>
          ) : (
            <PreviewEmpty icon={Image} title="No image descriptions" body="Vision was not enabled for this page, or no meaningful images were found." />
          )
        )}

        {tab === "links" && (
          hasLinks ? (
            <div className="preview-links-list">
              {page.links!.map((link, i) => (
                <div key={i} className="preview-link-item">
                  <ChevronRight size={10} style={{ color: "var(--brand)", flexShrink: 0 }} />
                  <button
                    className="preview-link-url font-mono text-xs text-secondary"
                    onClick={() => onSelectUrl?.(link)}
                    title={link}
                  >
                    {link}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <PreviewEmpty icon={Link2} title="No links captured" body="No outgoing links were stored for this page." />
          )
        )}
      </div>
    </div>
  );
}

function PreviewEmpty({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <div className="preview-empty-note">
      <Icon size={24} />
      <div>
        <div className="preview-empty-note__title">{title}</div>
        <p>{body}</p>
      </div>
    </div>
  );
}
