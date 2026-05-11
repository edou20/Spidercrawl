import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink, Search, Sparkles } from "lucide-react";
import { SearchHit, searchAllJobs } from "../api";

function hostname(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

function timeAgo(iso?: string) {
  if (!iso) return "unknown";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const lastAutoQuery = useRef("");
  const selected = results.find((result) => result.url === selectedUrl) ?? results[0] ?? null;

  const runSearch = async (override?: string) => {
    const nextQuery = (override ?? query).trim();
    if (!nextQuery) return;
    setQuery(nextQuery);
    setBusy(true);
    setError(null);
    setHasSearched(true);
    setLastQuery(nextQuery);
    try {
      const hits = await searchAllJobs(nextQuery, 20);
      setResults(hits);
      setSelectedUrl(hits[0]?.url ?? null);
    } catch (err: any) {
      setError(err.message);
      setResults([]);
      setSelectedUrl(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const q = (searchParams.get("q") ?? "").trim();
    if (!q || q === lastAutoQuery.current) return;
    lastAutoQuery.current = q;
    void runSearch(q);
  }, [searchParams]);

  return (
    <div className="search-page stack-lg anim-up">
      <div className="search-hero">
        <div>
          <div className="page-eyebrow">Knowledge Search</div>
          <h1><Search size={20} /> Search crawl memory</h1>
          <p>Search persisted crawl pages without long snippets or URLs pushing the interface off-screen.</p>
        </div>
      </div>

      {error && <div className="msg-banner err">{error}</div>}

      <div className="search-query-card">
        <div className="search-form-row">
          <label className="search-input-shell" aria-label="Search every crawl">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && runSearch()}
              placeholder="Search domains, snippets, docs, products..."
            />
          </label>
          <button className="btn btn-primary search-submit-btn" onClick={() => runSearch()} disabled={busy || !query.trim()}>
            {busy ? <><span className="spinner" /> Searching...</> : <><Search size={13} /> Search</>}
          </button>
        </div>
        <div className="search-status-line">
          {busy && <span>Searching persisted page titles, content, and crawl targets...</span>}
          {!busy && hasSearched && results.length > 0 && (
            <span><Sparkles size={12} /> Found {results.length} result{results.length === 1 ? "" : "s"} for "{lastQuery}"</span>
          )}
          {!busy && !hasSearched && <span>Tip: use names, domains, product terms, or snippets from crawled pages.</span>}
        </div>
      </div>

      {hasSearched && !busy && !error && results.length === 0 && (
        <div className="empty-state search-empty-state">
          <Search size={32} />
          <h3>No results for "{lastQuery}"</h3>
          <p>Try one or two keywords instead of a full phrase. The search now matches partial terms across page content and crawl targets.</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="search-results-layout">
          <div className="search-results-list">
            {results.map((result) => (
              <button
                key={`${result.job?.id}-${result.url}`}
                className={`search-result-card ${selected?.url === result.url ? "active" : ""}`}
                onClick={() => setSelectedUrl(result.url)}
              >
                <div className="search-result-top">
                  <div className="search-result-domain">
                    {result.job ? hostname(result.job.rootUrl) : hostname(result.url)}
                  </div>
                  <span className="search-score">{(result.similarity * 100).toFixed(0)}%</span>
                </div>
                <div className="search-result-snippet">{result.content}</div>
                <div className="search-result-url">{result.url}</div>
              </button>
            ))}
          </div>

          {selected && (
            <aside className="search-detail-card stack-sm">
              <div className="flex items-center justify-between gap-2" style={{ flexWrap: "wrap" }}>
                <div>
                  <div className="text-xs text-tertiary">Selected Result</div>
                  <div className="search-detail-title">{selected.title || hostname(selected.url)}</div>
                </div>
                <span className="badge badge-202">{selected.searchType}</span>
              </div>
              <div className="search-detail-url">{selected.url}</div>
              <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                {selected.job && <span className="badge badge-200">{hostname(selected.job.rootUrl)}</span>}
                <span className="badge badge-200">depth {selected.provenance.depth ?? "?"}</span>
                {selected.provenance.statusCode && (
                  <span className={`badge badge-${selected.provenance.statusCode}`}>{selected.provenance.statusCode}</span>
                )}
                <span className="text-xs text-tertiary">crawled {timeAgo(selected.provenance.crawledAt)}</span>
              </div>
              {selected.matchedTerms.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selected.matchedTerms.slice(0, 6).map((term: string) => (
                    <span key={term} className="badge badge-429">{term}</span>
                  ))}
                </div>
              )}
              <div className="search-preview">{selected.content}</div>
              <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                {selected.job && (
                  <Link className="btn btn-ghost btn-sm" to={`/jobs/${selected.job.id}`}>
                    <Search size={12} /> Open Crawl
                  </Link>
                )}
                <a className="btn btn-ghost btn-sm" href={selected.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} /> Open Source
                </a>
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
