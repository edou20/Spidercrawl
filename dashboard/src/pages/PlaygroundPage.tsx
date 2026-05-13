import { useState } from "react";
import { Zap, Play, Copy, CheckCheck, FileText, Code2, Eye, Globe } from "lucide-react";
import { getStoredApiKey } from "../api";
import { joinApiUrl, resolveApiBaseUrl } from "../api-base";

const EXAMPLES = [
  { label: "Apple iPhone", url: "https://www.apple.com/iphone/" },
  { label: "Web Crawler (Wiki)", url: "https://en.wikipedia.org/wiki/Web_crawler" },
  { label: "GitHub repo", url: "https://github.com/nicholasgasior/gsfmt" },
];

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

const API_BASE = resolveApiBaseUrl(
  typeof window !== "undefined" ? window.location.origin : "http://localhost:3200",
  import.meta.env.VITE_BACKEND_URL
);

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
      setResult(d.data ?? d);
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
    <div className="playground-page stack-lg anim-up">
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
                type="url"
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
            <label className="input-label playground-format-label">
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
              <span className="text-xs text-tertiary">{result.elapsedMs}ms · HTTP {result.statusCode}</span>
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
            <pre className="code-block playground-output">
              {outputText || <span style={{ color: "var(--text-disabled)" }}>No output</span>}
            </pre>
          ) : (
            <div className="card-body">
              <div className="playground-meta-grid">
                {[
                  ["title", result.title || "—"],
                  ["elapsed", `${result.elapsedMs}ms`],
                  ["status", String(result.statusCode)],
                  ...Object.entries(result.metadata ?? {}),
                ].map(([k, v]) => (
                  <div key={k} className="playground-meta-item">
                    <span className="text-xs text-disabled">
                      {k}
                    </span>
                    <span className="text-sm text-secondary font-mono">
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
        <div className="playground-empty-state">
          <Zap size={30} />
          <p>Enter a URL above and hit Run to see the extracted content.</p>
        </div>
      )}
    </div>
  );
}

function hostname(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}
