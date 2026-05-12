import { useState } from "react";
import { Zap, Play, Copy, CheckCheck, FileText, Code2, Eye, Globe } from "lucide-react";
import { getStoredApiKey } from "../api";
import { joinApiUrl, resolveApiBaseUrl } from "../api-base";

const EXAMPLES = [
  { label: "Apple iPhone", url: "https://www.apple.com/iphone/" },
  { label: "Web Crawler (Wiki)", url: "https://en.wikipedia.org/wiki/Web_crawler" },
  { label: "GitHub repo", url: "https://github.com/nicholasgasior/gsfmt" },
];

const API_BASE = resolveApiBaseUrl(
  typeof window !== "undefined" ? window.location.origin : "http://localhost:3200",
  import.meta.env.VITE_BACKEND_URL
);

type OutputMode = "markdown" | "json" | "html";

interface ScrapeResult {
  url: string;
  title: string;
  markdown?: string;
  html?: string;
  metadata: Record<string, any>;
  elapsedMs: number;
  statusCode: number;
}

export default function PlaygroundPage() {
  const [url,        setUrl]        = useState("");
  const [mode,       setMode]       = useState<OutputMode>("markdown");
  const [result,     setResult]     = useState<ScrapeResult | null>(null);
  const [busy,       setBusy]       = useState(false);
  const [err,        setErr]        = useState<string | null>(null);
  const [copied,     setCopied]     = useState(false);
  const [previewTab, setPreviewTab] = useState<"output" | "meta">("output");

  async function run() {
    if (!url) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const apiKey = getStoredApiKey();
      const res = await fetch(joinApiUrl(API_BASE, "/v1/scrape"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ url, formats: [mode] }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
      }
      const d = await res.json();
      const raw = d.data ?? d;
      // Normalise: backend may embed elapsedMs / statusCode inside metadata
      const meta = raw.metadata ?? {};
      setResult({
        ...raw,
        elapsedMs:  raw.elapsedMs  ?? meta.elapsedMs,
        statusCode: raw.statusCode ?? meta.statusCode,
      });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    const text = mode === "markdown" ? result.markdown
               : mode === "html"     ? result.html
               : JSON.stringify(result, null, 2);
    await navigator.clipboard.writeText(text ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const outputText = result
    ? mode === "markdown" ? result.markdown ?? ""
    : mode === "html"     ? result.html ?? ""
    : JSON.stringify(result, null, 2)
    : "";

  return (
    <div className="stack-lg anim-up" style={{ maxWidth: 900 }}>
      <div className="page-header">
        <h1>
          <Zap size={18} style={{ color: "var(--brand)", flexShrink: 0 }} />
          Scrape Playground
        </h1>
        <p>Instantly scrape any URL and inspect the extracted content, metadata, and structured output.</p>
      </div>

      {/* ── Input card ────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><Play size={13} /> Quick Scrape</span>
          <div className="flex items-center gap-2">
            {EXAMPLES.map(ex => (
              <button
                key={ex.url}
                className="btn btn-ghost btn-sm"
                onClick={() => setUrl(ex.url)}
                title={ex.url}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card-body stack">
          {/* URL + Run */}
          <div className="flex gap-2">
            <div className="input-with-icon flex-1">
              <Globe size={14} />
              <input
                type="text"
                placeholder="https://example.com/page"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && run()}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={run}
              disabled={busy || !url}
              style={{ flexShrink: 0 }}
            >
              {busy
                ? <><span className="spinner" /> Scraping…</>
                : <><Play size={13} /> Run</>
              }
            </button>
          </div>

          {/* Format picker */}
          <div>
            <label className="input-label" style={{ display: "block", marginBottom: 8 }}>
              Output Format
            </label>
            <div className="chip-group">
              {(["markdown", "json", "html"] as OutputMode[]).map(m => (
                <span
                  key={m}
                  className={`chip ${mode === m ? "on" : ""}`}
                  onClick={() => setMode(m)}
                >
                  {m}
                </span>
              ))}
            </div>
          </div>

          {err && (
            <div className="msg-banner err">
              <Zap size={13} />
              {err}
            </div>
          )}
        </div>
      </div>

      {/* ── Result ────────────────────────────────────────────── */}
      {result && (
        <div className="card anim-in">
          <div className="card-header">
            <div style={{ minWidth: 0 }}>
              <span className="card-title">
                <Eye size={13} />
                {result.title || hostname(result.url)}
              </span>
              <div className="text-xs text-tertiary font-mono mt-1 truncate" style={{ maxWidth: 400 }}>
                {result.url}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-tertiary">
                {result.elapsedMs != null ? `${result.elapsedMs}ms · ` : ""}HTTP {result.statusCode ?? "—"}
              </span>
              <div className="tabs">
                <button
                  className={`tab-btn ${previewTab === "output" ? "active" : ""}`}
                  onClick={() => setPreviewTab("output")}
                >
                  <FileText size={11} /> Output
                </button>
                <button
                  className={`tab-btn ${previewTab === "meta" ? "active" : ""}`}
                  onClick={() => setPreviewTab("meta")}
                >
                  <Code2 size={11} /> Metadata
                </button>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={copy}>
                {copied
                  ? <><CheckCheck size={12} /> Copied</>
                  : <><Copy size={12} /> Copy</>
                }
              </button>
            </div>
          </div>

          {previewTab === "output" ? (
            <pre className="code-block" style={{
              borderRadius: "0 0 var(--r-lg) var(--r-lg)",
              border: "none",
              borderTop: "1px solid var(--border-subtle)",
              maxHeight: 520,
              fontSize: 12.5,
              color: "var(--text-secondary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {outputText || <span style={{ color: "var(--text-disabled)" }}>No output</span>}
            </pre>
          ) : (
            <div className="card-body">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
                {[
                  ["title", result.title || "—"],
                  ["elapsed", result.elapsedMs != null ? `${result.elapsedMs}ms` : "—"],
                  ["status", result.statusCode != null ? String(result.statusCode) : "—"],
                  ...Object.entries(result.metadata ?? {}).filter(
                    ([k]) => !["elapsedMs", "statusCode", "status"].includes(k)
                  ),
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span className="text-xs text-disabled" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {k}
                    </span>
                    <span className="text-sm text-secondary font-mono" style={{ wordBreak: "break-all" }}>
                      {typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────── */}
      {!result && !busy && !err && (
        <div style={{
          textAlign: "center",
          padding: "52px 24px",
          color: "var(--text-disabled)",
          border: "1px dashed var(--border-subtle)",
          borderRadius: "var(--r-lg)",
          background: "rgba(0,0,0,0.10)",
        }}>
          <Zap size={30} style={{ margin: "0 auto 12px", display: "block", opacity: 0.3 }} />
          <p style={{ margin: 0, fontSize: 13 }}>Enter a URL above and hit Run to see the extracted content.</p>
        </div>
      )}
    </div>
  );
}

function hostname(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}
