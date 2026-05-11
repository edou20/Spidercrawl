import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Globe, CheckCircle, TrendingUp, Plus, ArrowRight, Clock,
  RefreshCw, Trash2, Download, Search, RotateCcw, AlertTriangle, Activity,
  BrainCircuit, Network, ShieldCheck, MessageSquare, SendHorizontal, FileText,
} from "lucide-react";
import {
  JobRow, Stats, listJobs, getStats, deleteJob, retryJob,
  exportJobAsJson, exportJobAsCsv, exportJobAsJsonl, exportJobAsFineTuneJsonl,
  getJobLinks, getJobPages, getJobEntities,
} from "../api";
import ErrorDisplay from "../components/ErrorDisplay";
import LoadingSpinner from "../components/LoadingSpinner";
import ForceGraph from "../components/ForceGraph";
import type { GNode, GEdge } from "../components/ForceGraph";
import { timeAgo, hostname, shortPath } from "../utils";
import { buildDashboardAskNavigation } from "../dashboard-ask";

type DashboardMode = "overview" | "crawls";

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="pulse-dot" />
      {status}
    </span>
  );
}

function MiniGraph({ jobId }: { jobId: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [loading, setLoading] = useState(false);

  // Measure container width
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.floor(w));
    });
    ro.observe(containerRef.current);
    setWidth(Math.floor(containerRef.current.getBoundingClientRect().width) || 480);
    return () => ro.disconnect();
  }, []);

  // Fetch real graph data from the latest completed job
  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    Promise.allSettled([
      getJobPages(jobId),
      getJobLinks(jobId),
      getJobEntities(jobId),
    ]).then(([pagesRes, linksRes, entitiesRes]) => {
      const pages   = pagesRes.status   === "fulfilled" ? pagesRes.value   : [];
      const links   = linksRes.status   === "fulfilled" ? linksRes.value   : [];
      const entities = entitiesRes.status === "fulfilled" ? entitiesRes.value : [];

      // Cap for mini display
      const MAX_PAGES    = 80;
      const MAX_ENTITIES = 40;
      const usedPages    = pages.slice(0, MAX_PAGES);
      const usedEntities = entities.slice(0, MAX_ENTITIES);

      const pageSet = new Set(usedPages.map(p => p.url));

      const gNodes: GNode[] = [
        ...usedPages.map(p => ({
          id: p.url,
          label: hostname(p.url) + (p.url.replace(/https?:\/\/[^/]+/, "") || "/"),
          color: "#38bdf8",
          size: 6,
          type: "page" as const,
        })),
        ...usedEntities.map(e => ({
          id: `entity:${e.name}`,
          label: e.name,
          color: "#a78bfa",
          size: 7 + Math.min((e.sourceUrls?.length ?? 1) * 1.5, 8),
          type: "entity" as const,
        })),
      ];

      const visibleIds = new Set(gNodes.map(n => n.id));
      const gEdges: GEdge[] = [
        ...links
          .filter(l => pageSet.has(l.from) && pageSet.has(l.to))
          .slice(0, 300)
          .map(l => ({ source: l.from, target: l.to })),
        ...usedEntities.flatMap(e =>
          (e.sourceUrls ?? [])
            .filter(u => pageSet.has(u))
            .map(u => ({ source: u, target: `entity:${e.name}` }))
        ).filter(e => visibleIds.has(e.source) && visibleIds.has(e.target)),
      ];

      setNodes(gNodes);
      setEdges(gEdges);
    }).finally(() => setLoading(false));
  }, [jobId]);

  if (!jobId) {
    return (
      <div className="knowledge-graph-preview graph-empty-state" style={{ height: 280, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <BrainCircuit size={28} style={{ color: "var(--brand)", opacity: 0.4 }} />
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Run a crawl to see the knowledge graph</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text-tertiary)", fontSize: 12 }}>
        <div className="spinner" />
        Building graph…
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: 280 }}>
      <ForceGraph nodes={nodes} edges={edges} width={width} height={280} />
    </div>
  );
}

function KnowledgeOpsOverview({
  stats,
  jobs,
  liveJobs,
  failedJobs,
  completedJobs,
  recentJobs,
  avgSatisfaction,
  isLoading,
  navigate,
}: {
  stats: Stats | null;
  jobs: JobRow[];
  liveJobs: JobRow[];
  failedJobs: JobRow[];
  completedJobs: JobRow[];
  recentJobs: JobRow[];
  avgSatisfaction: number | null;
  isLoading: boolean;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const latestCompleted = completedJobs[0] ?? null;
  const reliability = jobs.length > 0 ? Math.round((completedJobs.length / jobs.length) * 100) : null;
  const pagesIndexed = stats?.totalPages ?? jobs.reduce((sum, job) => sum + job.completedPages, 0);
  const askTarget = latestCompleted ?? recentJobs[0] ?? null;
  const [askDraft, setAskDraft] = useState("");

  const submitDashboardAsk = () => {
    const destination = buildDashboardAskNavigation(
      askTarget ? { id: askTarget.id, rootUrl: askTarget.rootUrl, completedPages: askTarget.completedPages } : null,
      askDraft || (askTarget ? `What did ${hostname(askTarget.rootUrl)} reveal?` : "")
    );
    navigate(destination.pathname, destination.state ? { state: destination.state } : undefined);
  };

  return (
    <section className="knowledge-ops" aria-label="Knowledge operations overview">
      <div className="knowledge-ops__header">
        <div>
          <div className="page-eyebrow">Knowledge Ops</div>
          <h1>Turn crawled web into source-backed answers.</h1>
          <p>
            Monitor reliability, inspect crawl memory, and move from raw pages to searchable knowledge without losing provenance.
          </p>
        </div>
        <div className="knowledge-ops__actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate("/search")}>
            <Search size={12} /> Search Knowledge
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate("/new")}>
            <Plus size={12} /> New Crawl
          </button>
        </div>
      </div>

      <div className="reliability-strip">
        <div className="reliability-metric reliability-metric--live">
          <span className="metric-label"><Activity size={12} /> Active Jobs</span>
          <strong>{stats?.activeJobs ?? liveJobs.length}</strong>
          <span>{liveJobs.length > 0 ? "Running now" : "Queue is idle"}</span>
        </div>
        <div className="reliability-metric">
          <span className="metric-label"><CheckCircle size={12} /> Completed</span>
          <strong>{stats?.completedJobs ?? completedJobs.length}</strong>
          <span>{failedJobs.length} failed</span>
        </div>
        <div className="reliability-metric">
          <span className="metric-label"><TrendingUp size={12} /> Pages Indexed</span>
          <strong>{pagesIndexed.toLocaleString()}</strong>
          <span>{avgSatisfaction != null ? `${Math.round(avgSatisfaction * 100)}% avg relevance` : "Across crawl memory"}</span>
        </div>
        <div className="reliability-metric">
          <span className="metric-label"><BrainCircuit size={12} /> AI Extraction</span>
          <strong className={stats?.aiAvailable ? "metric-ok" : "metric-muted"}>{stats?.aiAvailable ? "Healthy" : "Offline"}</strong>
          <span>{stats?.aiAvailable ? "Vision · extract · score" : "Add provider key"}</span>
        </div>
        <div className="reliability-metric">
          <span className="metric-label"><ShieldCheck size={12} /> Reliability</span>
          <strong className={reliability != null && reliability < 80 ? "metric-warn" : "metric-ok"}>
            {reliability != null ? `${reliability}%` : "Ready"}
          </strong>
          <span>{jobs.length > 0 ? "crawl completion rate" : "no runs yet"}</span>
        </div>
      </div>

      <div className="knowledge-ops-grid">
        <div className="knowledge-panel ask-panel">
          <div className="knowledge-panel__header">
            <span><MessageSquare size={14} /> Ask</span>
            {askTarget && <button className="link-btn" onClick={() => navigate(`/jobs/${askTarget.id}`)}>Open crawl</button>}
          </div>
          <div className="ask-input-preview">
            <input
              type="text"
              value={askDraft}
              onChange={(event) => setAskDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitDashboardAsk();
                }
              }}
              placeholder={askTarget ? `What did ${hostname(askTarget.rootUrl)} reveal?` : "What should this crawl teach the team?"}
            />
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={submitDashboardAsk} title="Ask this crawl">
              <SendHorizontal size={14} />
            </button>
          </div>
          <div className="answer-preview">
            <div className="answer-preview__meta">
              <span>Answer</span>
              <span>{askTarget ? "source-backed" : "ready after first crawl"}</span>
            </div>
            <p>
              {askTarget
                ? `Spidercrawl has indexed ${askTarget.completedPages.toLocaleString()} page${askTarget.completedPages === 1 ? "" : "s"} from ${hostname(askTarget.rootUrl)}. Open the crawl to ask grounded questions, inspect sources, and export the result.`
                : "Start a crawl to unlock answers, citations, entity maps, and source previews from the pages Spidercrawl collects."}
            </p>
            <div className="source-chip-row">
              {(recentJobs.length > 0 ? recentJobs : jobs).slice(0, 4).map((job, index) => (
                <button key={job.id} className="source-chip" onClick={() => navigate(`/jobs/${job.id}`)}>
                  <FileText size={12} />
                  <span>{hostname(job.rootUrl)}</span>
                  <em>{index + 1}</em>
                </button>
              ))}
              {recentJobs.length === 0 && jobs.length === 0 && (
                <>
                  <span className="source-chip source-chip--placeholder"><FileText size={12} /> markdown</span>
                  <span className="source-chip source-chip--placeholder"><Network size={12} /> graph</span>
                  <span className="source-chip source-chip--placeholder"><BrainCircuit size={12} /> answer</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="knowledge-panel graph-panel">
          <div className="knowledge-panel__header">
            <span><Network size={14} /> Knowledge Graph</span>
            <div className="graph-legend">
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <svg width="9" height="9"><circle cx="4.5" cy="4.5" r="3.5" fill="#38bdf8" opacity="0.85" /></svg> Pages
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <svg width="10" height="9" viewBox="0 0 10 9"><polygon points="5,0 9.3,2.5 9.3,7 5,9 0.7,7 0.7,2.5" fill="#a78bfa" opacity="0.85" /></svg> Entities
              </span>
            </div>
          </div>
          <MiniGraph jobId={latestCompleted?.id ?? (recentJobs[0]?.id ?? null)} />
        </div>
      </div>

      <div className="card overview-recent-card knowledge-recent-card">
        <div className="card-header">
          <span className="card-title">
            <Clock size={13} />
            Recent Crawls
          </span>
          <Link to="/crawls">
            <button className="btn btn-secondary btn-sm">
              View all crawls <ArrowRight size={12} />
            </button>
          </Link>
        </div>
        <div className="table-wrap">
          <table className="knowledge-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Status</th>
                <th>Pages</th>
                <th>Progress</th>
                <th>Updated</th>
                <th>Reliability</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7}><div className="flex items-center justify-center py-8" style={{ gap: 10 }}><LoadingSpinner loading /></div></td></tr>
              ) : recentJobs.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <Globe style={{ width: 36, height: 36 }} />
                      <h3>No crawls yet</h3>
                      <p>Launch the first crawl to build searchable, source-backed crawl memory.</p>
                      <button className="empty-state-action" onClick={() => navigate("/new")}>Start Crawl</button>
                    </div>
                  </td>
                </tr>
              ) : recentJobs.map((job) => (
                <tr key={job.id} className="clickable-row" onClick={() => navigate(`/jobs/${job.id}`)}>
                  <td>
                    <div className="knowledge-target">
                      <Globe size={14} />
                      <div>
                        <strong>{hostname(job.rootUrl)}</strong>
                        <span>{shortPath(job.rootUrl)}</span>
                      </div>
                    </div>
                  </td>
                  <td><StatusBadge status={job.status} /></td>
                  <td>{job.completedPages.toLocaleString()}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="progress" style={{ width: 96 }}>
                        <div className={`progress-fill ${job.status === "processing" ? "progress-fill--animated" : ""}`} style={{ width: `${job.progress}%` }} />
                      </div>
                      <span className="text-xs text-tertiary font-mono">{job.progress}%</span>
                    </div>
                  </td>
                  <td>{timeAgo(job.updatedAt)}</td>
                  <td>
                    <span className={job.status === "failed" ? "text-red" : "text-green"}>
                      {job.status === "failed" ? "attention" : "stable"}
                    </span>
                  </td>
                  <td><ArrowRight size={13} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ─── Component ────────────────────────────────────────────────── */
export default function DashboardPage({ mode = "overview" }: { mode?: DashboardMode }) {
  const navigate = useNavigate();
  const [jobs,         setJobs]         = useState<JobRow[]>([]);
  const [stats,        setStats]        = useState<Stats | null>(null);
  const [err,          setErr]          = useState<string | null>(null);
  const [isLoading,    setIsLoading]    = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery,  setSearchQuery]  = useState("");
  const [statusFilter, setStatusFilter] = useState<"all"|"queued"|"processing"|"completed"|"failed">("all");
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());
  const [bulkBusy,     setBulkBusy]     = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [refreshNote,   setRefreshNote]   = useState<string | null>(null);

  /* ── Data fetching ──────────────────────────────────────────── */
  const load = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    try {
      const [jobsResult, statsResult] = await Promise.allSettled([listJobs(), getStats()]);
      if (jobsResult.status === "rejected") throw jobsResult.reason;
      setJobs(jobsResult.value);
      if (statsResult.status === "fulfilled") setStats(statsResult.value);
      setErr(null);
      setLastRefreshAt(new Date());
      if (showRefresh) {
        setRefreshNote("Updated just now");
        window.setTimeout(() => setRefreshNote(null), 2200);
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [jobsResult, statsResult] = await Promise.allSettled([listJobs(), getStats()]);
        if (!alive) return;
        if (jobsResult.status === "rejected") throw jobsResult.reason;
        setJobs(jobsResult.value);
        if (statsResult.status === "fulfilled") setStats(statsResult.value);
        setErr(null);
        setLastRefreshAt(new Date());
      } catch (e: any) {
        if (alive) setErr(e.message);
      } finally {
        if (alive) setIsLoading(false);
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  /* ── Derived ────────────────────────────────────────────────── */
  const liveJobs = useMemo(
    () => jobs.filter((j) => j.status === "processing" || j.status === "queued"),
    [jobs]
  );
  const failedJobs = useMemo(() => jobs.filter((j) => j.status === "failed"), [jobs]);
  const avgSatisfaction = useMemo(() => {
    const scored = jobs.filter((j) => j.satisfactionScore != null && j.satisfactionScore > 0);
    if (!scored.length) return null;
    return scored.reduce((s, j) => s + j.satisfactionScore!, 0) / scored.length;
  }, [jobs]);
  const completedJobs = useMemo(() => jobs.filter((j) => j.status === "completed"), [jobs]);
  const recentJobs = useMemo(
    () => [...jobs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 3),
    [jobs]
  );

  /* ── Filtered list ──────────────────────────────────────────── */
  const filteredJobs = useMemo(() => jobs
    .filter((j) => {
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        j.rootUrl.toLowerCase().includes(q) ||
        (j.goal ?? "").toLowerCase().includes(q) ||
        j.id.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  [jobs, searchQuery, statusFilter]);

  /* ── Selection ──────────────────────────────────────────────── */
  const allSelected = selectedIds.size === filteredJobs.length && filteredJobs.length > 0;
  const toggleAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedIds(e.target.checked ? new Set(filteredJobs.map((j) => j.id)) : new Set());
  };
  const toggleOne = (id: string) => setSelectedIds((prev) => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });

  /* ── Bulk actions ───────────────────────────────────────────── */
  const withBulk = (fn: (ids: string[]) => Promise<void>) => async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setBulkBusy(true);
    try { await fn(ids); await load(); setSelectedIds(new Set()); }
    catch (e: any) { setErr(e.message); }
    finally { setBulkBusy(false); }
  };

  const handleBulkDelete          = withBulk(async (ids) => { for (const id of ids) await deleteJob(id); });
  const handleBulkRetry           = withBulk(async (ids) => { for (const id of ids) await retryJob(id); });
  const handleBulkExportJson      = withBulk(async ([id]) => { const d = await exportJobAsJson(id);           dl(JSON.stringify(d, null, 2), `crawl-${id}.json`,           "application/json"); });
  const handleBulkExportCsv       = withBulk(async ([id]) => { const c = await exportJobAsCsv(id);            dl(c,                          `crawl-${id}.csv`,            "text/csv;charset=utf-8;"); });
  const handleBulkExportJsonl     = withBulk(async ([id]) => { const j = await exportJobAsJsonl(id);          dl(j,                          `crawl-${id}.jsonl`,          "application/x-ndjson;charset=utf-8;"); });
  const handleBulkExportFineTune  = withBulk(async ([id]) => { const j = await exportJobAsFineTuneJsonl(id);  dl(j,                          `crawl-${id}-fine-tune.jsonl`, "application/x-ndjson;charset=utf-8;"); });

  function dl(content: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Render ─────────────────────────────────────────────────── */
  const isCrawlsMode = mode === "crawls";
  const statusOptions: Array<{ value: typeof statusFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "queued", label: "Queued" },
    { value: "processing", label: "Processing" },
    { value: "completed", label: "Completed" },
    { value: "failed", label: "Failed" },
  ];

  return (
    <div className={`stack-lg anim-up dashboard-surface dashboard-surface--${isCrawlsMode ? "crawls" : "overview"}`}>
      {isCrawlsMode && (
        <div className="page-intro page-intro--crawls">
          <div>
            <div className="page-eyebrow">Crawl Operations</div>
            <h1>Crawl operations board.</h1>
            <p>
              Filter runs, recover failures, and jump into any crawl without leaving the queue view.
            </p>
          </div>
          <div className="page-intro-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setStatusFilter("processing")}>
              <Activity size={12} /> Live only
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setStatusFilter("failed")}>
              <AlertTriangle size={12} /> Failed only
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate("/new")}>
              <Plus size={12} /> Launch Crawl
            </button>
          </div>
        </div>
      )}

      {!isCrawlsMode && (
        <KnowledgeOpsOverview
          stats={stats}
          jobs={jobs}
          liveJobs={liveJobs}
          failedJobs={failedJobs}
          completedJobs={completedJobs}
          recentJobs={recentJobs}
          avgSatisfaction={avgSatisfaction}
          isLoading={isLoading}
          navigate={navigate}
        />
      )}

      {/* ── Hero (first visit only) ──────────────────────────── */}
      {isCrawlsMode && (
        <div className="crawl-focus-grid">
          <button className={`crawl-focus-card ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>
            <div className="crawl-focus-label">All crawl jobs</div>
            <div className="crawl-focus-value">{jobs.length}</div>
            <div className="crawl-focus-meta">Full job list below; use filters to narrow it down</div>
          </button>
          <button className={`crawl-focus-card ${statusFilter === "processing" ? "active" : ""}`} onClick={() => setStatusFilter("processing")}>
            <div className="crawl-focus-label">Live queue</div>
            <div className="crawl-focus-value">{liveJobs.length}</div>
            <div className="crawl-focus-meta">Currently processing or queued</div>
          </button>
          <button className={`crawl-focus-card ${statusFilter === "failed" ? "active" : ""}`} onClick={() => setStatusFilter("failed")}>
            <div className="crawl-focus-label">Needs attention</div>
            <div className="crawl-focus-value">{failedJobs.length}</div>
            <div className="crawl-focus-meta">Retry or inspect failures quickly</div>
          </button>
          <div className="crawl-focus-card crawl-focus-card--info">
            <div className="crawl-focus-label">Recently updated</div>
            <div className="stack-sm">
              {recentJobs.length > 0 ? recentJobs.map((job) => (
                <button
                  key={job.id}
                  className="crawl-mini-link"
                  onClick={() => navigate(`/jobs/${job.id}`)}
                >
                  <span>{hostname(job.rootUrl)}</span>
                  <span>{timeAgo(job.updatedAt)}</span>
                </button>
              )) : (
                <span className="text-xs text-tertiary">No crawl activity yet.</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────── */}
      {err && (
        <div className="msg-banner err">
          <ErrorDisplay message={err} />
        </div>
      )}

      {/* ── Live Jobs highlight (when crawls are running) ─────── */}
      {liveJobs.length > 0 && !isLoading && (
        <div className="live-section">
          <div className="live-section-header">
            <div className="flex items-center gap-2">
              <span className="live-dot" />
              <span className="live-label">Live — {liveJobs.length} job{liveJobs.length > 1 ? "s" : ""} running</span>
            </div>
          </div>
          <div className="live-jobs-grid">
            {liveJobs.map((j) => (
              <div
                key={j.id}
                className="live-job-card"
                onClick={() => navigate(`/jobs/${j.id}`)}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") navigate(`/jobs/${j.id}`); }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-semibold text-sm">{hostname(j.rootUrl)}</div>
                    {j.goal && (
                      <div className="text-xs text-tertiary italic truncate" style={{ maxWidth: 220 }}>"{j.goal}"</div>
                    )}
                  </div>
                  <StatusBadge status={j.status} />
                </div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-tertiary">{j.completedPages} / {j.maxPages ?? "∞"} pages</span>
                  <span className="text-xs font-mono text-tertiary">{j.progress}%</span>
                </div>
                <div className="progress progress-lg">
                  <div className="progress-fill progress-fill--animated" style={{ width: `${j.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Failed jobs alert banner ─────────────────────────── */}
      {failedJobs.length > 0 && !isLoading && statusFilter === "all" && (
        <div className="failed-banner">
          <AlertTriangle size={14} style={{ color: "var(--red)", flexShrink: 0 }} />
          <span className="text-sm">
            <strong>{failedJobs.length}</strong> job{failedJobs.length > 1 ? "s" : ""} failed.
          </span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: "auto", color: "var(--red)", borderColor: "rgba(239,68,68,0.25)" }}
            onClick={() => setStatusFilter("failed")}
          >
            Show failed
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: "var(--red)", borderColor: "rgba(239,68,68,0.25)" }}
            onClick={() => setSelectedIds(new Set(failedJobs.map((j) => j.id)))}
          >
            Select all failed
          </button>
        </div>
      )}

      {/* ── Crawl Jobs Table ─────────────────────────────────── */}
      {isCrawlsMode && (
      <div className="card">

        {/* Card Header */}
        <div className="card-header">
          <span className="card-title">
            <Globe size={13} />
            Crawl Jobs
            {jobs.length > 0 && (
              <span style={{
                marginLeft: 4, fontSize: 11, fontWeight: 600,
                color: "var(--text-tertiary)", fontFamily: "var(--font-sans)",
              }}>
                {filteredJobs.length} / {jobs.length}
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => load(true)}
              disabled={isRefreshing}
              title="Refresh"
            >
              <RefreshCw size={12} className={isRefreshing ? "anim-spin" : ""} />
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </button>
            <span className="refresh-note" aria-live="polite">
              {refreshNote ?? (lastRefreshAt ? `Auto updated ${timeAgo(lastRefreshAt.toISOString())}` : "")}
            </span>
            <Link to="/new">
              <button className="btn btn-primary btn-sm">
                <Plus size={12} /> New Crawl
              </button>
            </Link>
          </div>
        </div>

        {/* Toolbar Row */}
        <div className="toolbar-row jobs-toolbar">
          <div className="toolbar-left">
            <div className="jobs-search-field">
              <span className="jobs-search-field__icon">
                <Search size={14} />
              </span>
              <input
                type="text"
                placeholder="Search jobs…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="status-filter-pills" role="group" aria-label="Filter crawl jobs by status">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`status-filter-pill ${statusFilter === option.value ? "active" : ""}`}
                  onClick={() => setStatusFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {selectedIds.size > 0 && (
              <span className="bulk-badge">{selectedIds.size} selected</span>
            )}
          </div>

          {selectedIds.size > 0 && (
            <div className="toolbar-right">
              <button className="btn btn-ghost btn-sm" onClick={handleBulkRetry}    disabled={bulkBusy}><RotateCcw size={12} /> Retry</button>
              <button className="btn btn-ghost btn-sm" onClick={handleBulkExportJson}     disabled={bulkBusy}><Download size={12} /> JSON</button>
              <button className="btn btn-ghost btn-sm" onClick={handleBulkExportCsv}      disabled={bulkBusy}><Download size={12} /> CSV</button>
              <button className="btn btn-ghost btn-sm" onClick={handleBulkExportJsonl}    disabled={bulkBusy}><Download size={12} /> JSONL</button>
              <button className="btn btn-ghost btn-sm" onClick={handleBulkExportFineTune} disabled={bulkBusy}><Download size={12} /> FT JSONL</button>
              <div className="divider-v" />
              <button className="btn btn-danger btn-sm" onClick={handleBulkDelete} disabled={bulkBusy}><Trash2 size={12} /> Delete</button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="th-check">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={filteredJobs.length === 0} title="Select all" />
                </th>
                <th>Target</th>
                <th>Goal</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Pages</th>
                <th>Started</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8}><div className="flex items-center justify-center py-8" style={{ gap: 10 }}><LoadingSpinner loading /></div></td></tr>
              ) : filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <Globe style={{ width: 36, height: 36 }} />
                      <h3>{searchQuery || statusFilter !== "all" ? "No matching jobs" : "No crawls yet"}</h3>
                      <p>
                        {searchQuery || statusFilter !== "all"
                          ? "Try adjusting your filters."
                          : "Launch your first crawl to start building your knowledge graph."}
                      </p>
                      {!searchQuery && statusFilter === "all" && (
                        <button className="empty-state-action" onClick={() => navigate("/new")}>Start Crawl</button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredJobs.map((j) => (
                  <tr
                    key={j.id}
                    className={`clickable-row ${j.status === "failed" ? "row-failed" : ""} ${j.status === "processing" ? "row-live" : ""}`}
                    tabIndex={0}
                    title="Open crawl details"
                    onClick={() => navigate(`/jobs/${j.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/jobs/${j.id}`); }
                    }}
                  >
                    <td className="td-check">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(j.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleOne(j.id)}
                        title="Select job"
                      />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
                        {hostname(j.rootUrl)}
                      </div>
                      <div className="text-xs text-tertiary truncate font-mono" style={{ maxWidth: 230, marginTop: 2 }}>
                        {shortPath(j.rootUrl)}
                      </div>
                    </td>
                    <td style={{ maxWidth: 200 }}>
                      {j.goal
                        ? <span className="text-sm text-secondary" style={{ fontStyle: "italic" }}>"{j.goal}"</span>
                        : <span className="text-xs text-disabled">breadth-first</span>
                      }
                    </td>
                    <td><StatusBadge status={j.status} /></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="progress" style={{ width: 80 }}>
                          <div
                            className={`progress-fill ${j.status === "processing" ? "progress-fill--animated" : ""}`}
                            style={{ width: `${j.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-tertiary font-mono">{j.progress}%</span>
                      </div>
                    </td>
                    <td>
                      <span className="font-semibold">{j.completedPages}</span>
                      <span className="text-tertiary text-xs"> / {j.maxPages ?? "∞"}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1 text-xs text-tertiary">
                        <Clock size={10} />
                        {timeAgo(j.createdAt)}
                      </div>
                    </td>
                    <td>
                      <Link to={`/jobs/${j.id}`} onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-ghost btn-sm btn-icon" title="View details">
                          <ArrowRight size={13} />
                        </button>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
