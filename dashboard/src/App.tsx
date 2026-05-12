import { useEffect, useState, type FormEvent, Component, type ReactNode, type ErrorInfo } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { LayoutDashboard, Globe, Plus, Settings, Zap, Key, Search, Calendar, BookOpen, AlertTriangle } from "lucide-react";
import DashboardPage from "./pages/DashboardPage";
import NewCrawlPage from "./pages/NewCrawlPage";
import JobDetailPage from "./pages/JobDetailPage";
import PlaygroundPage from "./pages/PlaygroundPage";
import SettingsPage from "./pages/SettingsPage";
import SearchPage from "./pages/SearchPage";
import SchedulesPage from "./pages/SchedulesPage";
import SystemStatusBar from "./components/SystemStatusBar";
import { getStats, getBillingInfo, type BillingInfo } from "./api";
import { resolveDocsUrl } from "./api-base";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("App crash:", error, info); }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div style={{ padding: 40, color: "var(--text-primary, #fff)", fontFamily: "monospace" }}>
          <h2 style={{ color: "#f87171", marginBottom: 16 }}>Something went wrong</h2>
          <pre style={{ background: "rgba(255,0,0,0.1)", padding: 16, borderRadius: 8, whiteSpace: "pre-wrap", fontSize: 13 }}>
            {err.message}{"\n\n"}{err.stack}
          </pre>
          <button
            style={{ marginTop: 16, padding: "8px 16px", cursor: "pointer" }}
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const DOCS_URL = resolveDocsUrl(
  typeof window !== "undefined" ? window.location.origin : "http://localhost:3200",
  import.meta.env.VITE_DOCS_URL
);

function Logo() {
  return (
    <div className="topbar-brand">
      <div className="brand-icon">
        <Zap size={18} fill="currentColor" />
      </div>
      <span className="brand-name">Spidercrawl</span>
    </div>
  );
}

function NavItem({ to, icon: Icon, label, badge, end }: {
  to: string; icon: any; label: string; badge?: number; end?: boolean;
}) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
      <Icon size={16} strokeWidth={2.5} />
      <span>{label}</span>
      {badge !== undefined && badge > 0 && <span className="nav-badge">{badge}</span>}
    </NavLink>
  );
}

export default function App() {
  const [activeJobs, setActiveJobs] = useState(0);
  const [quickSearch, setQuickSearch] = useState("");
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    getBillingInfo().then(setBilling).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const d = await getStats();
        if (!alive) return;
        setActiveJobs(d?.activeJobs ?? 0);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 6000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const submitQuickSearch = (event: FormEvent) => {
    event.preventDefault();
    const q = quickSearch.trim();
    if (!q) {
      navigate("/search");
      return;
    }
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="shell">
      {/* ── Topbar ──────────────────────────────────── */}
      <header className="topbar">
        <Logo />
        <form className="topbar-search" onSubmit={submitQuickSearch} role="search" aria-label="Search crawl knowledge">
          <Search size={15} />
          <input
            value={quickSearch}
            onChange={(event) => setQuickSearch(event.target.value)}
            placeholder="Search knowledge..."
          />
          <span className="topbar-search-kbd">/</span>
        </form>
        <div className="topbar-actions">
          <SystemStatusBar />
          <div className="divider-v" style={{ margin: "0 4px" }} />
          {activeJobs > 0 && (
            <div className="status-pill active topbar-live-badge">
              <span className="dot" />
              {activeJobs} running
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/playground")}>
            <Zap size={13} />
            Playground
          </button>
          <a className="btn btn-ghost btn-sm" href={DOCS_URL} target="_blank" rel="noreferrer">
            <BookOpen size={13} />
            Docs
          </a>
          <button className="btn btn-primary btn-sm" onClick={() => navigate("/new")}>
            <Plus size={13} />
            New Crawl
          </button>
        </div>
      </header>

      {/* ── Sidebar ──────────────────────────────────── */}
      <aside className="sidebar">
        <NavItem to="/" end icon={LayoutDashboard} label="Dashboard" />
        <NavItem to="/crawls" icon={Globe} label="Crawls" badge={activeJobs} />
        <NavItem to="/schedules" icon={Calendar} label="Schedules" />

        <div className="nav-section">
          <div className="nav-label">Tools</div>
          <NavItem to="/playground" icon={Zap} label="Playground" />
          <NavItem to="/search" icon={Search} label="Search" />
          <NavItem to="/new" icon={Plus} label="New Crawl" />
        </div>

        {/* Spacer — pushes developer section to bottom */}
        <div className="nav-spacer" />

        <div className="nav-section-bottom">
          <div className="nav-label">Developer</div>
          <NavItem to="/settings" end icon={Key} label="API Keys" />
          <NavItem to="/settings/config" icon={Settings} label="Settings" />
        </div>
      </aside>

      {/* ── Upgrade banner (shown when >80% quota used) ── */}
      {billing && billing.usagePercent >= 80 && (
        <div style={{
          gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10,
          padding: "8px 20px", fontSize: 13, fontWeight: 500,
          background: billing.usagePercent >= 100 ? "rgba(239,68,68,.12)" : "rgba(245,158,11,.1)",
          borderBottom: `1px solid ${billing.usagePercent >= 100 ? "rgba(239,68,68,.25)" : "rgba(245,158,11,.2)"}`,
        }}>
          <AlertTriangle size={13} style={{ color: billing.usagePercent >= 100 ? "var(--red)" : "#f59e0b", flexShrink: 0 }} />
          <span style={{ color: billing.usagePercent >= 100 ? "var(--red)" : "#f59e0b" }}>
            {billing.usagePercent >= 100
              ? "Monthly page limit reached — crawls paused."
              : `${billing.usagePercent}% of your monthly page limit used.`}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: "auto", borderColor: billing.usagePercent >= 100 ? "rgba(239,68,68,.3)" : "rgba(245,158,11,.3)", color: billing.usagePercent >= 100 ? "var(--red)" : "#f59e0b" }}
            onClick={() => navigate("/settings")}
          >
            Upgrade plan →
          </button>
        </div>
      )}

      {/* ── Main ─────────────────────────────────────── */}
      <main className="main">
        <ErrorBoundary>
          <Routes>
            <Route path="/"              element={<DashboardPage mode="overview" />} />
            <Route path="/crawls"        element={<DashboardPage mode="crawls" />} />
            <Route path="/new"           element={<NewCrawlPage />} />
            <Route path="/jobs/:id"      element={<JobDetailPage />} />
            <Route path="/playground"    element={<PlaygroundPage />} />
            <Route path="/search"        element={<SearchPage />} />
            <Route path="/schedules"     element={<SchedulesPage />} />
            <Route path="/settings"      element={<SettingsPage />} />
            <Route path="/settings/config" element={<SettingsPage />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
