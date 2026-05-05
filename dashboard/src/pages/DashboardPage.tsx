import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Globe, Zap, CheckCircle, TrendingUp, Plus, ArrowRight, Clock,
  RefreshCw, Trash2, Download, Search, RotateCcw, AlertTriangle, Activity,
} from "lucide-react";
import {
  JobRow, Stats, listJobs, getStats, deleteJob, retryJob,
  exportJobAsJson, exportJobAsCsv, exportJobAsJsonl, exportJobAsFineTuneJsonl,
} from "../api";
import ErrorDisplay from "../components/ErrorDisplay";
import LoadingSpinner from "../components/LoadingSpinner";
import { timeAgo, hostname, shortPath } from "../utils";

type DashboardMode = "overview" | "crawls";

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="pulse-dot" />
      {status}
    </span>
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
  const hasJobs = jobs.length > 0;
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

      {!isCrawlsMode && stats && hasJobs && (
        <div className="overview-hero">
          <div>
            <div className="page-eyebrow">Mission Control</div>
            <h1>Web intelligence cockpit.</h1>
            <p>
              Track crawl health, indexed pages, failed jobs, and the fastest path back into extraction work.
            </p>
          </div>
          <div className="overview-hero-actions">
            <button className="btn btn-primary btn-sm" onClick={() => navigate("/new")}>
              <Plus size={12} /> New Crawl
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate("/search")}>
              <Search size={12} /> Search Knowledge
            </button>
          </div>
        </div>
      )}

      {/* ── Hero (first visit only) ──────────────────────────── */}
      {!isCrawlsMode && !isLoading && !hasJobs && (
        <div className="hero">
          <h1>
            The web is <span className="g">structured data</span><br />
            waiting to be unlocked.
          </h1>
          <p>
            AI-native crawling with multimodal extraction, goal-oriented link
            discovery, and semantic search — purpose-built for LLM pipelines.
          </p>
          <div className="hero-cta">
            <button className="btn btn-primary btn-lg" onClick={() => navigate("/new")}>
              <Plus size={14} /> Start First Crawl
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => navigate("/playground")}>
              <Zap size={14} /> Try Playground
            </button>
          </div>
        </div>
      )}

      {/* ── Stats ────────────────────────────────────────────── */}
      {stats && !isCrawlsMode && (
        <div className="stats-grid">
          <div className="stat-card anim-up" style={{ ["--stat-gradient" as any]: "linear-gradient(90deg,#22c55e,#4ade80)" }}>
            <div className="stat-card-accent" />
            <div className="stat-label"><Globe size={11} /> Total Crawls</div>
            <div className="stat-value">{stats.totalJobs}</div>
            <div className="stat-sub">{stats.completedJobs} completed · {stats.failedJobs} failed</div>
          </div>
          <div className={`stat-card anim-up ${stats.activeJobs > 0 ? "stat-card--live" : ""}`} style={{ ["--stat-gradient" as any]: "linear-gradient(90deg,#f59e0b,#fbbf24)" }}>
            <div className="stat-card-accent" />
            <div className="stat-label">
              <Activity size={11} className={stats.activeJobs > 0 ? "anim-pulse" : ""} />
              Active Jobs
            </div>
            <div className="stat-value" style={{ color: stats.activeJobs > 0 ? "#fbbf24" : undefined }}>
              {stats.activeJobs}
            </div>
            <div className="stat-sub">{stats.activeJobs > 0 ? "Running now" : "Idle"}</div>
          </div>
          <div className="stat-card anim-up" style={{ ["--stat-gradient" as any]: "linear-gradient(90deg,#3b82f6,#60a5fa)" }}>
            <div className="stat-card-accent" />
            <div className="stat-label"><TrendingUp size={11} /> Pages Indexed</div>
            <div className="stat-value">{stats.totalPages.toLocaleString()}</div>
            <div className="stat-sub">
              {avgSatisfaction != null
                ? `${(avgSatisfaction * 100).toFixed(0)}% avg relevance`
                : "Across all crawls"}
            </div>
          </div>
          <div className="stat-card anim-up" style={{
            ["--stat-gradient" as any]: `linear-gradient(90deg,${stats.aiAvailable ? "#8b5cf6,#a78bfa" : "#334155,#475569"})`,
          }}>
            <div className="stat-card-accent" />
            <div className="stat-label"><CheckCircle size={11} /> AI Status</div>
            <div className="stat-value" style={{
              fontSize: 20, paddingTop: 6,
              color: stats.aiAvailable ? "#a78bfa" : "var(--text-disabled)",
            }}>
              {stats.aiAvailable ? "Online" : "Offline"}
            </div>
            <div className="stat-sub">
              {stats.aiAvailable ? "Vision · Extract · Score" : "Set API key to enable"}
            </div>
          </div>
        </div>
      )}

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

      {!isCrawlsMode && completedJobs.length > 0 && (
        <div className="crawl-focus-grid">
          <div className="crawl-focus-card crawl-focus-card--info">
            <div className="crawl-focus-label">Completion rate</div>
            <div className="crawl-focus-value">
              {jobs.length > 0 ? `${Math.round((completedJobs.length / jobs.length) * 100)}%` : "0%"}
            </div>
            <div className="crawl-focus-meta">Share of crawls that reached completion</div>
          </div>
          <div className="crawl-focus-card crawl-focus-card--info">
            <div className="crawl-focus-label">Average relevance</div>
            <div className="crawl-focus-value">
              {avgSatisfaction != null ? `${Math.round(avgSatisfaction * 100)}%` : "N/A"}
            </div>
            <div className="crawl-focus-meta">Based on scored jobs with satisfaction data</div>
          </div>
          <div className="crawl-focus-card crawl-focus-card--info">
            <div className="crawl-focus-label">Fast path</div>
            <div className="crawl-focus-meta">Jump straight back into the crawl studio or semantic playground.</div>
            <div className="page-intro-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate("/new")}>
                <Plus size={12} /> New Crawl
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate("/search")}>
                <Search size={12} /> Search
              </button>
            </div>
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

      {!isCrawlsMode && hasJobs && (
        <div className="card overview-recent-card">
          <div className="card-header">
            <span className="card-title">
              <Clock size={13} />
              Recent Crawl Activity
            </span>
            <Link to="/crawls">
              <button className="btn btn-secondary btn-sm">
                Open Operations <ArrowRight size={12} />
              </button>
            </Link>
          </div>
          <div className="overview-recent-list">
            {recentJobs.map((job) => (
              <button
                key={job.id}
                className="overview-recent-row"
                onClick={() => navigate(`/jobs/${job.id}`)}
              >
                <div className="overview-recent-main">
                  <strong>{hostname(job.rootUrl)}</strong>
                  <span>{job.goal ? `"${job.goal}"` : "breadth-first crawl"}</span>
                </div>
                <div className="overview-recent-meta">
                  <StatusBadge status={job.status} />
                  <span>{job.completedPages} / {job.maxPages ?? "∞"} pages</span>
                  <span>{timeAgo(job.updatedAt)}</span>
                  <ArrowRight size={13} />
                </div>
              </button>
            ))}
          </div>
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
