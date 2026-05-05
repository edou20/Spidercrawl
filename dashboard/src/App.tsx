import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { LayoutDashboard, Globe, Plus, Settings, Zap, Key, Search, Calendar } from "lucide-react";
import DashboardPage from "./pages/DashboardPage";
import NewCrawlPage from "./pages/NewCrawlPage";
import JobDetailPage from "./pages/JobDetailPage";
import PlaygroundPage from "./pages/PlaygroundPage";
import SettingsPage from "./pages/SettingsPage";
import SearchPage from "./pages/SearchPage";
import SchedulesPage from "./pages/SchedulesPage";
import SystemStatusBar from "./components/SystemStatusBar";
import { getStats } from "./api";

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
  const [aiOn, setAiOn] = useState(false);
  const [activeJobs, setActiveJobs] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const d = await getStats();
        if (!alive) return;
        setAiOn(!!d?.aiAvailable);
        setActiveJobs(d?.activeJobs ?? 0);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 6000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="shell">
      {/* ── Topbar ──────────────────────────────────── */}
      <header className="topbar">
        <Logo />
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

      {/* ── Main ─────────────────────────────────────── */}
      <main className="main">
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
      </main>
    </div>
  );
}
