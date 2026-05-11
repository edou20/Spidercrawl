import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Search, FileText, Tag, ExternalLink, Cpu, Database, Target,
  Download, RefreshCw, ArrowLeft, Globe, CheckCircle2, AlertTriangle,
  Eye, ShieldAlert, Radio, Braces, MessageSquare, Sparkles, Layers, Network,
  SendHorizonal,
} from "lucide-react";
import {
  getJobStatus, getJobPages, getJobEntities, getJobLinks, getPageDetail, exportRag, searchRag, startCrawl,
  getJobEvents, getJobSummary, askJob, rerunJobEntities, rerunJobExtraction,
  JobRow, PageRow, SearchHit, EntityRow, CrawlEvent,
} from "../api";
import { EntityTag, entityStyle } from "../entities";
import ForceGraph from "../components/ForceGraph";
import type { GNode, GEdge } from "../components/ForceGraph";
import PagePreviewPanel from "../components/PagePreviewPanel";
import CrawlEventLog from "../components/CrawlEventLog";
import ErrorDisplay from "../components/ErrorDisplay";
import LoadingSpinner from "../components/LoadingSpinner";
import { useCrawlStream } from "../hooks/useCrawlStream";
import { timeAgo, hostname, pathname } from "../utils";
import { buildRerunRequest } from "../job-rerun";

type MainTab    = "pages" | "preview" | "graph" | "errors" | "events" | "ask" | "extracted";
type GraphFilter = "all" | "pages" | string;

function pageDisplayTitle(page: PageRow) {
  return page.title || hostname(page.url);
}

function humanizeAskError(message: string) {
  if (/api key not valid|API_KEY_INVALID|rejected the configured API key|invalid api key|unauthorized|permission_denied/i.test(message)) {
    return "The AI provider rejected the configured API key. Update GOOGLE_AI_API_KEY or OPENAI_API_KEY, then ask again.";
  }
  if (/quota|rate limit|too many requests|temporarily unavailable/i.test(message)) {
    return "The AI provider is temporarily unavailable because of quota or rate limits. Try again later or switch providers.";
  }
  if (/AI provider not configured|not configured/i.test(message)) {
    return "Ask AI needs an AI provider key. Configure GOOGLE_AI_API_KEY or OPENAI_API_KEY first.";
  }
  return message.length > 220 ? `${message.slice(0, 220)}…` : message;
}

function parseFailedPageCount(message?: string | null) {
  const match = message?.match(/(\d+)\s+page fetches failed/i);
  return match ? Number(match[1]) : 0;
}

export default function JobDetailPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const id = params.id ?? (
    typeof window !== "undefined"
      ? window.location.pathname.match(/\/jobs\/([^/]+)/)?.[1]
      : undefined
  );
  const [job,        setJob]        = useState<JobRow | null>(null);
  const [pages,      setPages]      = useState<PageRow[]>([]);
  const [entities,   setEntities]   = useState<EntityRow[]>([]);
  const [pageLinks,  setPageLinks]  = useState<Array<{ from: string; to: string }>>([]);
  const [tab,        setTab]        = useState<MainTab>("pages");
  const [graphFilter, setGraphFilter] = useState<GraphFilter>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedPageDetail, setSelectedPageDetail] = useState<PageRow | null>(null);
  const [previewPageUrl, setPreviewPageUrl]  = useState<string | null>(null);
  const [previewDetail, setPreviewDetail]    = useState<PageRow | null>(null);
  const [previewLoading, setPreviewLoading]  = useState(false);
  const [query,      setQuery]      = useState("");
  const [results,    setResults]    = useState<SearchHit[]>([]);
  const [searchDone, setSearchDone] = useState(false);
  const [searchFilter, setSearchFilter] = useState<"all" | "strong" | "best">("all");
  const [selectedSearchUrl, setSelectedSearchUrl] = useState<string | null>(null);
  const [historicalEvents, setHistoricalEvents] = useState<CrawlEvent[]>([]);
  const [busy,       setBusy]       = useState<string | null>(null);
  const [err,        setErr]        = useState<string | null>(null);

  // Phase 2: Answer Layer
  const [summary,        setSummary]        = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [askQ,           setAskQ]           = useState("");
  const [askAnswer,      setAskAnswer]      = useState<string | null>(null);
  const [askSources,     setAskSources]     = useState<string[]>([]);
  const [askLoading,     setAskLoading]     = useState(false);
  const [askError,       setAskError]       = useState<string | null>(null);
  const askInputRef = useRef<HTMLInputElement>(null);
  const askPanelRef = useRef<HTMLDivElement>(null);
  const graphCardRef = useRef<HTMLDivElement>(null);
  const [graphWidth, setGraphWidth] = useState(800);
  const autoAskHandledRef = useRef(false);

  const isActive = job?.status === "processing" || job?.status === "queued";
  const { events: streamEvents, connected } = useCrawlStream(id, isActive);

  /* ── Fetch ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!id) return;
    let alive = true;

    const loadRelated = async (jobId: string, status?: string) => {
      const [pagesResult, entitiesResult, linksResult] = await Promise.allSettled([
        getJobPages(jobId),
        getJobEntities(jobId),
        getJobLinks(jobId),
      ]);
      if (!alive) return;

      if (pagesResult.status === "fulfilled") setPages(pagesResult.value);
      if (entitiesResult.status === "fulfilled") setEntities(entitiesResult.value);
      if (linksResult.status === "fulfilled") setPageLinks(linksResult.value);

      if (status === "completed" || status === "failed") {
        getJobEvents(jobId).then((events) => { if (alive) setHistoricalEvents(events); }).catch(() => {});
      }
    };

    const fetchAll = async () => {
      try {
        const j = await getJobStatus(id);
        if (!alive) return;
        setJob(j);
        await loadRelated(id, j.status);
      } catch (e: any) {
        if (alive) setErr(e.message);
      }
    };

    fetchAll();

    const t = setInterval(async () => {
      if (!alive) return;
      try {
        const j = await getJobStatus(id);
        if (!alive) return;
        setJob(j);
        await loadRelated(id, j.status);
        if (j.status === "completed" || j.status === "failed") clearInterval(t);
      } catch {}
    }, 3000);

    return () => { alive = false; clearInterval(t); };
  }, [id]);

  // Measure graph card width responsively
  useEffect(() => {
    if (tab !== "graph" || !graphCardRef.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setGraphWidth(Math.floor(w));
    });
    ro.observe(graphCardRef.current);
    setGraphWidth(Math.floor(graphCardRef.current.getBoundingClientRect().width) || 800);
    return () => ro.disconnect();
  }, [tab]);

  // Load summary when job completes (lazy — generates on first call)
  useEffect(() => {
    if (!id || !job) return;
    if (job.status !== "completed") return;
    if (summary !== null) return;
    setSummaryLoading(true);
    getJobSummary(id)
      .then((r) => setSummary(r.summary))
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, [id, job?.status]);

  // Load full page detail for graph node selection
  useEffect(() => {
    if (id && selectedNodeId && selectedNodeId.startsWith("http")) {
      getPageDetail(id, selectedNodeId).then(setSelectedPageDetail).catch(() => {});
    } else {
      setSelectedPageDetail(null);
    }
  }, [id, selectedNodeId]);

  // Load full page detail for preview tab
  useEffect(() => {
    if (!id || !previewPageUrl) { setPreviewDetail(null); return; }
    setPreviewLoading(true);
    setPreviewDetail(null);
    getPageDetail(id, previewPageUrl)
      .then(setPreviewDetail)
      .catch(() => {})
      .finally(() => setPreviewLoading(false));
  }, [id, previewPageUrl]);

  const handleRefresh = async () => {
    if (!id) return;
    setBusy("refreshing");
    try {
      const j = await getJobStatus(id);
      setJob(j);
      const [pagesResult, entitiesResult, linksResult] = await Promise.allSettled([
        getJobPages(id),
        getJobEntities(id),
        getJobLinks(id),
      ]);
      if (pagesResult.status === "fulfilled") setPages(pagesResult.value);
      if (entitiesResult.status === "fulfilled") setEntities(entitiesResult.value);
      if (linksResult.status === "fulfilled") setPageLinks(linksResult.value);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  };

  const handleExport = async () => {
    if (!id) return;
    setBusy("exporting");
    try {
      const data = await exportRag(id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `crawl-${id}.json` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  };

  const handleRerun = async () => {
    if (!id || !job) return;
    setBusy("rerunning");
    try {
      const res = await startCrawl(buildRerunRequest(id, job));
      navigate(`/jobs/${res.id}`);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  };

  const handleRerunExtraction = async () => {
    if (!id || !job) return;
    const defaultPrompt = job.extractionPrompt || job.goal || "Extract key structured facts from each page.";
    const prompt = window.prompt("Extraction prompt", defaultPrompt);
    if (!prompt?.trim()) return;
    setBusy("extracting");
    try {
      const res = await rerunJobExtraction(id, prompt.trim());
      await handleRefresh();
      window.alert(`Extraction rerun complete: ${res.extracted}/${res.processed} updated${res.failed ? `, ${res.failed} failed` : ""}.`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const handleRerunEntities = async () => {
    if (!id) return;
    const confirmed = window.confirm(
      "Re-run AI entity resolution for this crawl? This will replace the current entity list and may use AI provider quota."
    );
    if (!confirmed) return;
    setBusy("entities");
    try {
      const res = await rerunJobEntities(id);
      const refreshed = await getJobEntities(id);
      setEntities(refreshed);
      window.alert(
        `Entity resolution finished: ${res.entitiesFound} found across ${res.pagesProcessed} pages, ${res.entitiesAfterMerge} stored after merge.`
      );
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const handleSearch = async () => {
    if (!id || !query.trim()) return;
    setBusy("searching");
    try {
      const r = await searchRag(id, query);
      setResults(r);
      setSearchDone(true);
      setSelectedSearchUrl(r[0]?.url ?? null);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  };

  const handleAsk = async (question = askQ) => {
    const text = question.trim();
    if (!id || !text) return;
    setAskQ(text);
    setAskLoading(true);
    setAskAnswer(null);
    setAskSources([]);
    setAskError(null);
    try {
      const r = await askJob(id, text);
      setAskAnswer(r.answer);
      setAskSources(r.sources);
    } catch (e: any) { setAskError(humanizeAskError(e.message)); }
    finally { setAskLoading(false); }
  };

  const openAskTab = () => {
    setTab("ask");
    window.setTimeout(() => {
      askPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      askInputRef.current?.focus();
    }, 80);
  };

  useEffect(() => {
    const askState = location.state as
      | { openTab?: "ask"; initialAskQuestion?: string; autoAsk?: boolean }
      | null;
    if (!askState?.openTab || askState.openTab !== "ask") return;

    setTab("ask");
    setAskQ(askState.initialAskQuestion ?? "");

    if (askState.autoAsk && askState.initialAskQuestion?.trim() && !autoAskHandledRef.current) {
      autoAskHandledRef.current = true;
      void handleAsk(askState.initialAskQuestion);
    }
  }, [location.state, id]);

  const openPreview = (url: string) => {
    setPreviewPageUrl(url);
    setTab("preview");
  };

  /* ── Derived ── */
  const entityCount  = entities.length;
  // For live jobs show stream events; for finished jobs show historical from DB
  const displayEvents: CrawlEvent[] = isActive
    ? streamEvents.map((e) => ({ jobId: e.jobId, type: e.type, url: e.url, data: e.data, ts: e.ts }))
    : historicalEvents;
  const lastErrorSnippet = useMemo(() => {
    const event = [...displayEvents].reverse().find((e) => e.type === "page.failed" || e.type === "job.failed");
    const msg = event?.data?.error;
    return typeof msg === "string" ? msg : null;
  }, [displayEvents]);
  const jobErrorSnippet = lastErrorSnippet || job?.error || null;
  const pageByUrl    = new Map(pages.map((p) => [p.url, p]));
  const entityById   = new Map(entities.map((e) => [e.id, e]));
  const entityTypes  = Array.from(new Set(entities.map((e) => e.type))).sort();

  const errorPages   = useMemo(
    () => pages.filter((p) => p.statusCode >= 400 || p.statusCode === 0),
    [pages]
  );
  const errorsByCode = useMemo(() => {
    const map = new Map<number, PageRow[]>();
    for (const p of errorPages) {
      const list = map.get(p.statusCode) ?? [];
      list.push(p);
      map.set(p.statusCode, list);
    }
    return map;
  }, [errorPages]);

  const filteredEntities = useMemo(() => {
    if (graphFilter === "pages") return [];
    if (graphFilter === "all") return entities;
    return entities.filter(e => e.type === graphFilter);
  }, [entities, graphFilter]);

  const visiblePages = useMemo(() => {
    if (graphFilter === "all" || graphFilter === "pages") return pages;
    const relatedUrls = new Set(filteredEntities.flatMap(e => e.sourceUrls));
    return pages.filter(p => relatedUrls.has(p.url));
  }, [pages, filteredEntities, graphFilter]);

  const NODE_LIMIT = 250;
  const isThrottled = graphFilter === "all" && (visiblePages.length + filteredEntities.length) > NODE_LIMIT;

  const throttledData = useMemo(() => {
    if (!isThrottled) return { nodes: visiblePages, entities: filteredEntities };
    
    // For "all" filter, if over limit, pick 150 earliest pages (root-first structure) and 100 entities
    const earlyPages = [...visiblePages].sort((a, b) => 
      new Date(a.crawledAt).getTime() - new Date(b.crawledAt).getTime()
    ).slice(0, 150);
    
    const earlyPageUrls = new Set(earlyPages.map(p => p.url));
    const relevantEntities = filteredEntities.filter(e => 
      e.sourceUrls.some(url => earlyPageUrls.has(url))
    ).slice(0, 100);

    return { nodes: earlyPages, entities: relevantEntities };
  }, [visiblePages, filteredEntities, isThrottled]);

  const graphNodes: GNode[] = useMemo(() => [
    ...throttledData.nodes.map((p) => ({ id: p.url, label: pageDisplayTitle(p), color: "#38bdf8", size: 8, type: "page" as const })),
    ...throttledData.entities.map((e) => ({
      id: e.id,
      label: e.name,
      color: entityStyle(e.type).color,
      size: Math.min(13, 7 + Math.max(0, e.sourceUrls.length - 1)),
      type: "entity" as const,
    })),
  ], [throttledData, graphFilter]);

  const graphEdges: GEdge[] = useMemo(() => {
    const visibleNodeIds = new Set(graphNodes.map(n => n.id));
    const edges: GEdge[] = [];

    // 1. Page-to-Page links
    for (const link of pageLinks) {
      if (visibleNodeIds.has(link.from) && visibleNodeIds.has(link.to)) {
        edges.push({ source: link.from, target: link.to });
      }
    }

    // 2. Page-to-Entity links
    for (const e of throttledData.entities) {
      for (const url of e.sourceUrls) {
        if (visibleNodeIds.has(url) && visibleNodeIds.has(e.id)) {
          edges.push({ source: url, target: e.id });
        }
      }
    }

    return edges;
  }, [graphNodes, pageLinks, throttledData.entities]);

  const selectedPage        = selectedNodeId ? pageByUrl.get(selectedNodeId) ?? null : null;
  const selectedEntity      = selectedNodeId ? entityById.get(selectedNodeId) ?? null : null;
  const selectedEntityPages = selectedEntity
    ? selectedEntity.sourceUrls.map((url) => pageByUrl.get(url)).filter((p): p is PageRow => !!p)
    : [];

  const enrichedResults = results.map((r) => ({ ...r, page: pageByUrl.get(r.url) ?? null }));
  const filteredResults  = enrichedResults.filter((r) => {
    if (searchFilter === "strong") return r.similarity >= 0.6;
    if (searchFilter === "best")   return r.similarity >= 0.8;
    return true;
  });
  const selectedSearchResult = filteredResults.find((r) => r.url === selectedSearchUrl) ?? filteredResults[0] ?? null;

  if (err && !job) return (
    <div className="stack-lg anim-up">
      <Link to="/" className="back-link"><ArrowLeft size={13} /> Back to Dashboard</Link>
      <div className="msg-banner err"><ErrorDisplay message={err} /></div>
    </div>
  );

  if (!job) return (
    <div className="flex items-center justify-center py-8" style={{ gap: 12, color: "var(--text-tertiary)" }}>
      <LoadingSpinner loading />
      <span className="text-sm">Loading crawl…</span>
    </div>
  );

  const entityResolutionRequested = !!job.enableEntities;
  const adaptiveBudgetRequested = !!job.adaptiveBudget;
  const failedPageEvents = displayEvents.filter((event) => event.type === "page.failed");
  const failedPageCount = failedPageEvents.length || parseFailedPageCount(job.error);
  const hasRelevanceScore = typeof job.satisfactionScore === "number";
  const relevanceValue = hasRelevanceScore ? `${(job.satisfactionScore! * 100).toFixed(0)}%` : (adaptiveBudgetRequested ? "Pending" : "Off");

  return (
    <div className="stack-lg anim-up">
      <Link to="/" className="back-link">
        <ArrowLeft size={13} />
        Back to Dashboard
      </Link>

      {/* ── Job header card ── */}
      <div className="card">
        <div className="card-header">
          <div style={{ minWidth: 0 }}>
            <div className="flex items-center gap-3">
              <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px" }}>
                {hostname(job.rootUrl)}
              </h1>
              <span className={`badge badge-${job.status}`}>
                <span className="pulse-dot" />
                {job.status}
              </span>
              {(job.extractionPrompt || job.extractionSchema) && (
                <span className="badge badge-ghost" style={{ gap: 4, fontSize: 10 }}>
                  <Braces size={10} /> extraction
                </span>
              )}
            </div>
            <div className="text-xs text-tertiary font-mono mt-1 truncate" style={{ maxWidth: 500 }}>
              {job.rootUrl}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button className="btn btn-ghost btn-sm" onClick={handleRefresh} disabled={!!busy}>
              <RefreshCw size={12} className={busy === "refreshing" ? "spin" : ""} />
              {busy === "refreshing" ? "Refreshing…" : "Refresh"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleRerun} disabled={!!busy}>
              <RefreshCw size={12} className={busy === "rerunning" ? "spin" : ""} />
              {busy === "rerunning" ? "Re-running…" : "Re-run"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleRerunExtraction} disabled={!!busy}>
              <Braces size={12} className={busy === "extracting" ? "spin" : ""} />
              {busy === "extracting" ? "Extracting…" : "Re-run Extraction"}
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleExport} disabled={!!busy}>
              <Download size={12} />
              {busy === "exporting" ? "Exporting…" : "Export JSON"}
            </button>
          </div>
        </div>
        <div className="card-body stack-sm">
          <div className="job-overview-grid">
            <div className="job-overview-block">
              <div className="text-xs text-tertiary mb-1">Goal</div>
              <div className="text-sm">
                {job.goal || "Breadth-first exploration with no explicit goal"}
              </div>
            </div>
            <div className="job-overview-block">
              <div className="text-xs text-tertiary mb-1">Progress</div>
              <div className="flex items-center gap-2">
                <div className="progress" style={{ flex: 1 }}>
                  <div className="progress-fill progress-fill--animated" style={{ width: `${job.progress}%` }} />
                </div>
                <span className="font-mono text-xs text-tertiary">{job.progress}%</span>
              </div>
            </div>
            <div className="job-overview-block">
              <div className="text-xs text-tertiary mb-1">Updated</div>
              <div className="text-sm">{timeAgo(job.updatedAt)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary strip — shown once job is complete */}
      {job.status === "completed" && (summary || summaryLoading) && (
        <div className="card">
          <div
            className="card-body"
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              background: "linear-gradient(135deg, rgba(34,211,238,0.08), rgba(99,102,241,0.08))",
            }}
          >
            <Sparkles size={14} style={{ color: "var(--brand-light)", flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div className="text-xs text-tertiary mb-1" style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>
                AI Summary
              </div>
              {summaryLoading ? (
                <span className="text-xs text-tertiary" style={{ fontStyle: "italic" }}>Generating summary…</span>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                  {summary}
                </div>
              )}
            </div>
            {!summaryLoading && summary && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ flexShrink: 0 }}
                onClick={openAskTab}
              >
                <MessageSquare size={11} /> Ask more
              </button>
            )}
          </div>
        </div>
      )}

      {jobErrorSnippet && (
        <div className="card job-diagnostic-card">
          <div className="card-body">
            <div className="job-diagnostic-card__eyebrow">
              Job diagnostic
            </div>
            <div className="job-diagnostic-card__title">
              This crawl reported an error while fetching or processing a page.
            </div>
            <div className="job-diagnostic-card__body">
              {jobErrorSnippet}
            </div>
            <div className="job-diagnostic-card__help">
              This is a job-level worker diagnostic. Open Events for the exact step that failed; the HTTP Errors tab only lists pages that returned bad status codes.
            </div>
          </div>
        </div>
      )}

      {/* ── Stats row ── */}
      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="stat-card">
          <div className="stat-card-accent" />
          <div className="stat-label"><Globe size={11} /> Pages Crawled</div>
          <div className="stat-value">{job.completedPages}</div>
          <div className="stat-sub">
            {job.skippedPages ? <span style={{ color: "#34d399" }}>{job.skippedPages} skipped</span> : `of ${job.maxPages ?? "∞"} max`}
          </div>
        </div>
        <div className={`stat-card ${entityResolutionRequested && entityCount === 0 ? "stat-card--muted" : ""}`}>
          <div className="stat-card-accent" />
          <div className="stat-label"><Tag size={11} /> AI Entities</div>
          <div className="stat-value">{entityCount}</div>
          <div className="stat-sub">
            {!entityResolutionRequested
              ? "Entity resolver was off"
              : entityCount > 0
                ? `${entityTypes.length} type${entityTypes.length === 1 ? "" : "s"} stored`
                : "Enabled, but no entities were stored"}
          </div>
          {entityResolutionRequested && entityCount === 0 && (
            <button className="stat-card-action" onClick={handleRerunEntities} disabled={!!busy}>
              <RefreshCw size={11} className={busy === "entities" ? "spin" : ""} />
              {busy === "entities" ? "Resolving…" : "Re-run entities"}
            </button>
          )}
        </div>
        <div className={`stat-card ${!adaptiveBudgetRequested ? "stat-card--muted" : ""}`}>
          <div className="stat-card-accent" />
          <div className="stat-label"><Target size={11} /> Adaptive Relevance</div>
          <div className="stat-value">
            {relevanceValue}
          </div>
          <div className="stat-sub">
            {!adaptiveBudgetRequested
              ? "Adaptive budget was off"
              : hasRelevanceScore
                ? `Stop threshold ${Math.round((job.satisfactionThreshold ?? 0.3) * 100)}%`
                : "Needs scored non-root links"}
          </div>
        </div>
        <div className={`stat-card ${errorPages.length > 0 ? "stat-card--alert" : ""}`}>
          <div className="stat-card-accent" />
          <div className="stat-label"><ShieldAlert size={11} /> HTTP Status Errors</div>
          <div className="stat-value" style={{ color: errorPages.length > 0 ? "var(--red)" : undefined }}>
            {errorPages.length}
          </div>
          <div className="stat-sub">
            {errorPages.length > 0
              ? <button className="link-btn" onClick={() => setTab("errors")}>View HTTP errors</button>
              : failedPageCount > 0
                ? <button className="link-btn" onClick={() => setTab("events")}>0 HTTP errors · {failedPageCount} worker failures</button>
                : "All saved pages returned OK"}
          </div>
        </div>
      </div>

      {(entityCount === 0 || !adaptiveBudgetRequested || failedPageCount > 0) && (
        <div className="metric-explainer">
          <div>
            <strong>How to read these cards</strong>
            <span>These are separate diagnostics, so a zero can still be healthy.</span>
          </div>
          <ul>
            <li>
              <Tag size={12} />
              <span>
                <strong>AI Entities:</strong>{" "}
                {entityResolutionRequested
                  ? "entity resolution was requested, but no canonical entity rows are currently stored."
                  : "entity resolution was not enabled for this crawl."}
              </span>
            </li>
            <li>
              <Target size={12} />
              <span>
                <strong>Adaptive Relevance:</strong>{" "}
                {adaptiveBudgetRequested
                  ? "score appears after enough AI-scored links are processed."
                  : "adaptive budget was off, so there is no relevance score to show."}
              </span>
            </li>
            <li>
              <ShieldAlert size={12} />
              <span>
                <strong>HTTP Status Errors:</strong> this only counts saved pages with bad HTTP status codes.
                {failedPageCount > 0 ? ` This crawl also has ${failedPageCount} worker-level fetch/processing failure${failedPageCount === 1 ? "" : "s"} in Events.` : ""}
              </span>
            </li>
          </ul>
        </div>
      )}

      {/* ── Job config ── */}
      <div className="card">
        <div className="card-header"><span className="card-title"><Target size={13} /> Job Configuration</span></div>
        <div className="card-body stack-sm">
          <div className="flex gap-8">
            <div style={{ flex: 1 }}>
              <div className="text-xs text-tertiary mb-1">Crawl Goal</div>
              <div className="text-sm font-medium" style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>
                {job.goal ? `"${job.goal}"` : "Breadth-first exploration (no specific goal)"}
              </div>
            </div>
            {(job.extractionPrompt || job.extractionSchema) && (
              <div style={{ flex: 1 }}>
                <div className="text-xs text-tertiary mb-1">Extraction Strategy</div>
                <div className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                  {job.extractionPrompt ? "LLM Prompt-based" : "JSON Schema-based"}
                </div>
                <pre style={{
                  marginTop: 6, fontSize: 11, background: "rgba(0,0,0,0.2)",
                  padding: "6px 10px", borderRadius: 4, color: "var(--text-tertiary)",
                  maxHeight: 80, overflow: "auto",
                }}>
                  {job.extractionPrompt || JSON.stringify(job.extractionSchema, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main tabs ── */}
      <div className="card">
        <div className="card-header" style={{ borderBottom: "none", paddingBottom: 0 }}>
          <div className="tabs">
            <button className={`tab-btn ${tab === "pages" ? "active" : ""}`} onClick={() => setTab("pages")}>
              <Database size={12} /> Pages
              {pages.length > 0 && <span className="tab-count">{pages.length}</span>}
            </button>
            <button className={`tab-btn ${tab === "preview" ? "active" : ""}`} onClick={() => setTab("preview")}>
              <Eye size={12} /> Preview
            </button>
            <button className={`tab-btn ${tab === "graph" ? "active" : ""}`} onClick={() => setTab("graph")}>
              <Cpu size={12} /> Graph
            </button>
            <button
              className={`tab-btn ${tab === "errors" ? "active" : ""} ${errorPages.length > 0 ? "tab-btn--alert" : ""}`}
              onClick={() => setTab("errors")}
            >
              <AlertTriangle size={12} /> HTTP Errors
              {errorPages.length > 0 && <span className="tab-count tab-count--err">{errorPages.length}</span>}
            </button>
            <button className={`tab-btn ${tab === "events" ? "active" : ""}`} onClick={() => setTab("events")}>
              <Radio size={12} />
              Events
              {connected && <span className="tab-count" style={{ background: "var(--green)", color: "#fff" }}>live</span>}
              {!connected && displayEvents.length > 0 && <span className={`tab-count ${failedPageCount > 0 ? "tab-count--err" : ""}`}>{displayEvents.length}</span>}
            </button>
            <button className={`tab-btn ${tab === "ask" ? "active" : ""}`} onClick={openAskTab}>
              <MessageSquare size={12} /> Ask AI
            </button>
            {pages.some((p) => p.extractedData) && (
              <button className={`tab-btn ${tab === "extracted" ? "active" : ""}`} onClick={() => setTab("extracted")}>
                <Layers size={12} /> Extracted
                <span className="tab-count">{pages.filter((p) => p.extractedData).length}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Pages tab ── */}
      {tab === "pages" && (
        <div className="stack-md">
          <div className="card">
            <div className="card-header">
              <span className="card-title"><Search size={13} /> Semantic Search</span>
              {searchDone && (
                <span className="text-xs text-tertiary">
                  {filteredResults.length} result{filteredResults.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="card-body">
              <div className="stack-sm">
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1"
                    placeholder="Search crawled content semantically…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                  <button className="btn btn-primary" onClick={handleSearch} disabled={busy === "searching" || !query.trim()}>
                    {busy === "searching" ? "Searching…" : "Search"}
                  </button>
                </div>
                {searchDone && (
                  <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                    <button className={`btn btn-sm ${searchFilter === "all" ? "btn-primary" : "btn-ghost"}`} onClick={() => setSearchFilter("all")}>
                      All
                    </button>
                    <button className={`btn btn-sm ${searchFilter === "strong" ? "btn-primary" : "btn-ghost"}`} onClick={() => setSearchFilter("strong")}>
                      Strong match
                    </button>
                    <button className={`btn btn-sm ${searchFilter === "best" ? "btn-primary" : "btn-ghost"}`} onClick={() => setSearchFilter("best")}>
                      Best only
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {searchDone && (
            <div className="card">
              <div className="card-header">
                <span className="card-title"><FileText size={13} /> Search Results</span>
              </div>
              <div className="card-body">
                {filteredResults.length === 0 ? (
                  <div className="empty-state" style={{ padding: "24px 0" }}>
                    <Search size={26} style={{ opacity: 0.3 }} />
                    <h3 style={{ marginTop: 12 }}>No matching pages</h3>
                    <p>Try a broader phrase or switch the match filter.</p>
                  </div>
                ) : (
                  <div className="grid-2" style={{ alignItems: "start" }}>
                    <div className="stack-sm">
                      {filteredResults.map((result) => (
                        <button
                          key={result.url}
                          className={`search-result-card ${selectedSearchResult?.url === result.url ? "active" : ""}`}
                          onClick={() => setSelectedSearchUrl(result.url)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div style={{ minWidth: 0 }}>
                              <div className="font-semibold text-sm truncate">
                                {result.page?.title || result.title || hostname(result.url)}
                              </div>
                              <div className="font-mono text-xs text-tertiary truncate">{result.url}</div>
                            </div>
                            <span className="badge badge-ghost">{Math.round(result.similarity * 100)}%</span>
                          </div>
                          <div className="text-xs text-secondary mt-2" style={{ lineHeight: 1.6 }}>
                            {result.description || result.content.slice(0, 180)}
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="search-detail-card">
                      {selectedSearchResult && (
                        <div className="stack-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div style={{ minWidth: 0 }}>
                              <div className="font-semibold text-sm truncate">
                                {selectedSearchResult.page?.title || selectedSearchResult.title || hostname(selectedSearchResult.url)}
                              </div>
                              <div className="font-mono text-xs text-tertiary truncate">{selectedSearchResult.url}</div>
                            </div>
                            <div className="flex gap-2">
                              <button className="btn btn-ghost btn-sm" onClick={() => openPreview(selectedSearchResult.url)}>
                                <Eye size={12} /> Preview
                              </button>
                              <a href={selectedSearchResult.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm btn-icon">
                                <ExternalLink size={12} />
                              </a>
                            </div>
                          </div>
                          <div className="search-preview" style={{ whiteSpace: "pre-wrap" }}>
                            {selectedSearchResult.content}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <span className="card-title"><Database size={13} /> Crawled Pages</span>
              <span className="text-xs text-tertiary">Click a row to preview its full content</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Status</th>
                    <th>Entities</th>
                    <th>Tables</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => (
                    <tr
                      key={p.id}
                      className={`clickable-row ${previewPageUrl === p.url ? "row-active" : ""}`}
                      tabIndex={0}
                      onClick={() => openPreview(p.url)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPreview(p.url); } }}
                      title="Click to preview page content"
                    >
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{hostname(p.url)}</div>
                        <div className="text-xs text-tertiary truncate font-mono" style={{ maxWidth: 300 }}>{pathname(p.url)}</div>
                      </td>
                      <td><span className={`badge badge-${p.statusCode >= 400 ? "failed" : p.statusCode >= 300 ? "queued" : "completed"}`}>{p.statusCode}</span></td>
                      <td>{p.entityType ? <EntityTag type={p.entityType} /> : "—"}</td>
                      <td>{p.tableCount ?? 0}</td>
                      <td>
                        <div className="flex gap-1">
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Preview content"
                            onClick={(e) => { e.stopPropagation(); openPreview(p.url); }}
                          >
                            <Eye size={12} />
                          </button>
                          <a href={p.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm btn-icon" onClick={(e) => e.stopPropagation()}>
                            <ExternalLink size={12} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview tab ── */}
      {tab === "preview" && (
        <div className="card" style={{ overflow: "hidden" }}>
          <PagePreviewPanel
            page={previewDetail}
            loading={previewLoading}
            onSelectUrl={(url) => {
              const found = pageByUrl.get(url);
              if (found) openPreview(url);
            }}
          />
        </div>
      )}

      {/* ── Graph tab ── */}
      {tab === "graph" && (
        <div className="card" ref={graphCardRef}>
          <div className="card-header">
            <div className="stack-sm" style={{ width: "100%" }}>
              <div className="flex items-center justify-between gap-3" style={{ flexWrap: "wrap" }}>
                <div>
                  <span className="card-title"><Network size={13} /> Crawl graph</span>
                  <div className="text-xs text-tertiary mt-1">
                    Relationships between crawled pages and extracted entities. Normal scrolling now moves the page; use the graph buttons to zoom or fit the view.
                  </div>
                </div>
                <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                  {selectedNodeId && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelectedNodeId(null)}>
                      Clear selection
                    </button>
                  )}
                  {isThrottled && (
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 text-amber-500 rounded text-[10px] font-bold border border-amber-500/20">
                      <ShieldAlert size={10} /> GRAPH LIMITED FOR PERFORMANCE
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                <button
                  className={`btn btn-sm ${graphFilter === "pages" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setGraphFilter(graphFilter === "pages" ? "all" : "pages")}
                >
                  Pages only
                </button>
                {entityTypes.map((type) => (
                  <button
                    key={type}
                    className={`btn btn-sm ${graphFilter === type ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setGraphFilter(type === graphFilter ? "all" : type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ height: 580, position: "relative" }}>
            <ForceGraph
              nodes={graphNodes}
              edges={graphEdges}
              width={graphWidth}
              height={580}
              selectedNodeId={selectedNodeId}
              onNodeClick={setSelectedNodeId}
            />
          </div>

          {(selectedPage || selectedEntity) && (
            <div className="card-body" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              {selectedPage && (
                <div className="stack-sm">
                  <div className="flex items-center justify-between">
                    <h3 style={{ fontSize: 16, fontWeight: 700 }}>{pageDisplayTitle(selectedPage)}</h3>
                    <div className="flex gap-2">
                      <button className="btn btn-ghost btn-sm" onClick={() => openPreview(selectedPage.url)}>
                        <Eye size={12} /> Preview
                      </button>
                      <a href={selectedPage.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                  <div className="text-xs text-tertiary font-mono">{selectedPage.url}</div>
                  {selectedPageDetail ? (
                    <div className="search-preview anim-in" style={{ maxHeight: 200, overflow: "auto" }}>
                      {selectedPageDetail.markdown}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-4 text-tertiary">
                      <LoadingSpinner loading size="sm" />
                      <span className="text-xs">Loading content…</span>
                    </div>
                  )}
                </div>
              )}
              {selectedEntity && (
                <div className="stack-sm">
                  <div className="flex items-center gap-2">
                    <EntityTag type={selectedEntity.type} />
                    <h3 style={{ fontSize: 16, fontWeight: 700 }}>{selectedEntity.name}</h3>
                  </div>
                  <p className="text-sm text-secondary">{selectedEntity.description}</p>
                  <div className="text-xs text-tertiary mt-2">Appears in {selectedEntity.sourceUrls.length} pages</div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {selectedEntityPages.map((p) => (
                      <button key={p.url} className="badge badge-ghost" onClick={() => setSelectedNodeId(p.url)}>
                        {hostname(p.url)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Events tab ── */}
      {tab === "events" && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <Radio size={13} /> Crawl Events
              {connected && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginLeft: 8, fontSize: 11, color: "var(--green)" }}>
                  <span className="live-dot" style={{ width: 6, height: 6 }} />
                  Live
                </span>
              )}
            </span>
            <span className="text-xs text-tertiary">
              {displayEvents.length} event{displayEvents.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <CrawlEventLog events={displayEvents} connected={connected} autoScroll={isActive} />
          </div>
        </div>
      )}

      {/* ── Errors tab ── */}
      {tab === "errors" && (
        <div className="stack-md">
          {errorPages.length === 0 ? (
            <div className="card">
              <div className="empty-state" style={{ padding: "40px 0" }}>
                <CheckCircle2 style={{ width: 36, height: 36, color: "var(--green)" }} />
                <h3 style={{ marginTop: 12 }}>No HTTP errors</h3>
                <p>All crawled pages returned successful status codes.</p>
              </div>
            </div>
          ) : (
            Array.from(errorsByCode.entries())
              .sort(([a], [b]) => b - a)
              .map(([code, codePages]) => (
                <div key={code} className="card">
                  <div className="card-header">
                    <span className="card-title">
                      <ShieldAlert size={13} style={{ color: "var(--red)" }} />
                      HTTP {code}
                      <span className="tab-count tab-count--err" style={{ marginLeft: 6 }}>{codePages.length}</span>
                    </span>
                    <span className="text-xs text-tertiary">{httpCodeLabel(code)}</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>URL</th>
                          <th>Depth</th>
                          <th>Crawled</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {codePages.map((p) => (
                          <tr key={p.id} className="clickable-row" onClick={() => openPreview(p.url)}>
                            <td>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{hostname(p.url)}</div>
                              <div className="text-xs text-tertiary truncate font-mono" style={{ maxWidth: 380 }}>{pathname(p.url)}</div>
                            </td>
                            <td><span className="font-mono text-xs text-tertiary">{p.depth ?? "—"}</span></td>
                            <td><span className="text-xs text-tertiary">{timeAgo(p.crawledAt)}</span></td>
                            <td>
                              <a href={p.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm btn-icon" onClick={(e) => e.stopPropagation()}>
                                <ExternalLink size={12} />
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
          )}
        </div>
      )}
      {/* ── Ask tab ── */}
      {tab === "ask" && (
        <div className="card" ref={askPanelRef}>
          <div className="card-header">
            <span className="card-title"><MessageSquare size={13} /> Ask AI About This Crawl</span>
            <span className="text-xs text-tertiary">Searches crawled pages, then writes an answer with sources</span>
          </div>
          <div className="card-body stack">
            <div className="ask-explainer">
              <Sparkles size={14} />
              <div>
                <strong>Use this when you want a quick answer instead of reading every crawled page.</strong>
                <span> Example: “What API docs did you find?” or “Summarize the main product claims.”</span>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                ref={askInputRef}
                type="text"
                className="flex-1"
                placeholder={`Ask anything about ${hostname(job.rootUrl)}…`}
                value={askQ}
                onChange={(e) => setAskQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                disabled={askLoading}
              />
              <button
                className="btn btn-primary"
                onClick={() => { void handleAsk(); }}
                disabled={askLoading || !askQ.trim()}
                style={{ gap: 6 }}
              >
                {askLoading
                  ? <><span className="spinner" /> Thinking…</>
                  : <><SendHorizonal size={12} /> Ask</>
                }
              </button>
            </div>

            {askError && (
              <div className="msg-banner err">
                <ErrorDisplay message={askError} />
              </div>
            )}

            {!askAnswer && !askLoading && (
              <div className="ask-suggestion-wrap">
                <div className="text-xs text-tertiary" style={{ width: "100%" }}>
                  Try one of these. Clicking a suggestion asks it immediately.
                </div>
                {[
                  job.goal ? `Summarize what you found for: ${job.goal}` : null,
                  "What are the main topics covered?",
                  "What are the key findings?",
                  "Are there any pricing or product details?",
                ].filter(Boolean).slice(0, 3).map((q) => (
                  <button
                    key={q!}
                    className="ask-suggestion"
                    onClick={() => { void handleAsk(q!); }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {askAnswer && (
              <div className="anim-in stack-sm">
                <div style={{
                  padding: "16px 18px",
                  borderRadius: 10,
                  background: "rgba(139,92,246,0.07)",
                  border: "1px solid rgba(139,92,246,0.2)",
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: "var(--text-primary)",
                  whiteSpace: "pre-wrap",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, opacity: 0.7, fontSize: 11 }}>
                    <Sparkles size={11} style={{ color: "#a78bfa" }} />
                    <span style={{ color: "var(--text-tertiary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Answer</span>
                  </div>
                  {askAnswer}
                </div>

                {askSources.length > 0 && (
                  <div>
                    <div className="text-xs text-tertiary mb-2" style={{ fontWeight: 600 }}>Sources ({askSources.length})</div>
                    <div className="stack-sm">
                      {askSources.map((url) => (
                        <div key={url} className="flex items-center gap-2">
                          <button
                            className="link-btn text-xs font-mono truncate"
                            style={{ maxWidth: 480, textAlign: "left" }}
                            onClick={() => openPreview(url)}
                          >
                            {url}
                          </button>
                          <a href={url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm btn-icon" title="Open URL">
                            <ExternalLink size={11} />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  className="btn btn-ghost btn-sm"
                  style={{ alignSelf: "flex-start", fontSize: 11 }}
                  onClick={() => { setAskAnswer(null); setAskSources([]); setAskQ(""); askInputRef.current?.focus(); }}
                >
                  Ask another question
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Extracted tab ── */}
      {tab === "extracted" && (
        <div className="stack-md">
          {pages.filter((p) => p.extractedData).length === 0 ? (
            <div className="card">
              <div className="empty-state" style={{ padding: "40px 0" }}>
                <Layers size={36} style={{ opacity: 0.3 }} />
                <h3 style={{ marginTop: 12 }}>No extracted data yet</h3>
                <p>Extracted data appears here as pages are crawled with an extraction prompt or schema.</p>
              </div>
            </div>
          ) : (
            pages.filter((p) => p.extractedData).map((page) => (
              <div key={page.id} className="card anim-in">
                <div className="card-header">
                  <div style={{ minWidth: 0 }}>
                    <div className="font-semibold text-sm truncate">{page.title || hostname(page.url)}</div>
                    <div className="font-mono text-xs text-tertiary truncate" style={{ maxWidth: 500 }}>{page.url}</div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openPreview(page.url)} title="Preview page">
                      <Eye size={12} />
                    </button>
                    <a href={page.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm btn-icon">
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                  <pre style={{
                    margin: 0,
                    padding: "14px 18px",
                    fontSize: 12,
                    background: "rgba(0,0,0,0.2)",
                    borderTop: "1px solid var(--border-subtle)",
                    borderRadius: "0 0 var(--r-lg) var(--r-lg)",
                    overflowX: "auto",
                    color: "#93c5fd",
                    fontFamily: "var(--font-mono)",
                    lineHeight: 1.6,
                    maxHeight: 320,
                    overflowY: "auto",
                  }}>
                    {JSON.stringify(page.extractedData, null, 2)}
                  </pre>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function httpCodeLabel(code: number): string {
  const labels: Record<number, string> = {
    0:   "Connection failed / timeout",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    429: "Rate Limited",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };
  return labels[code] ?? `HTTP ${code}`;
}
