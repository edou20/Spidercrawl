import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { 
  Calendar, Clock, Play, Pause, Trash2, Plus, 
  ArrowLeft, Globe, Target, AlertCircle, CheckCircle2 
} from "lucide-react";
import { listSchedules, toggleSchedule, deleteSchedule, ScheduleRow } from "../api";
import { formatDistanceToNow } from "date-fns";

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await listSchedules();
      setSchedules(data);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function onToggle(id: string, current: boolean) {
    try {
      await toggleSchedule(id, !current);
      setSchedules(curr => curr.map(s => s.id === id ? { ...s, active: !current } : s));
      setErr(null);
    } catch (e: any) {
      setErr(`Failed to toggle schedule: ${e.message}`);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Are you sure you want to delete this schedule?")) return;
    try {
      await deleteSchedule(id);
      setSchedules(curr => curr.filter(s => s.id !== id));
      setErr(null);
    } catch (e: any) {
      setErr(`Failed to delete schedule: ${e.message}`);
    }
  }

  return (
    <div className="stack-lg anim-up">
      <div className="flex justify-between items-end">
        <div>
          <Link to="/" className="back-link">
            <ArrowLeft size={13} /> Back to Dashboard
          </Link>
          <div className="page-header" style={{ marginBottom: 0 }}>
            <h1><Calendar size={18} style={{ color: "var(--brand)" }} /> Schedules</h1>
            <p>Manage recurring crawl tasks and automated data extraction.</p>
          </div>
        </div>
        <Link to="/new" className="btn btn-primary">
          <Plus size={14} /> New Schedule
        </Link>
      </div>

      {err && (
        <div className="msg-banner err">
          <AlertCircle size={14} /> {err}
        </div>
      )}

      {loading ? (
        <div className="card">
          <div className="card-body flex justify-center py-12">
            <span className="spinner" />
          </div>
        </div>
      ) : schedules.length === 0 ? (
        <div className="card">
          <div className="card-body stack items-center py-12 text-center" style={{ gap: 16 }}>
            <div className="pi" style={{ padding: 20, background: "rgba(255,255,255,0.04)", borderRadius: "50%" }}>
              <Clock size={32} style={{ opacity: 0.3 }} />
            </div>
            <div>
              <h3 className="text-primary font-semibold">No active schedules</h3>
              <p className="text-tertiary text-sm">Create a schedule to automate your crawling workflows.</p>
            </div>
            <Link to="/new" className="btn btn-secondary btn-sm">
              Create First Schedule
            </Link>
          </div>
        </div>
      ) : (
        <div className="stack">
          {schedules.map(s => (
            <div key={s.id} className={`card schedule-card ${!s.active ? "inactive" : ""}`}>
              <div className="card-body flex justify-between items-start">
                <div className="stack" style={{ gap: 12, flex: 1 }}>
                  <div className="flex items-center gap-3">
                    <div className={`status-dot ${s.active ? "online" : "offline"}`} />
                    <h3 className="font-semibold text-primary text-lg">{s.name}</h3>
                    <span className="badge badge-outline">{s.cron}</span>
                  </div>

                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <div className="flex items-center gap-1.5 text-secondary text-sm">
                      <Globe size={13} style={{ opacity: 0.5 }} />
                      <span className="text-tertiary">Target:</span>
                      <span className="font-medium">{s.url}</span>
                    </div>
                    {s.goal && (
                      <div className="flex items-center gap-1.5 text-secondary text-sm">
                        <Target size={13} style={{ opacity: 0.5 }} />
                        <span className="text-tertiary">Goal:</span>
                        <span className="truncate" style={{ maxWidth: 200 }}>{s.goal}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-6 pt-2 border-t border-color-subtle">
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="text-xs text-tertiary uppercase tracking-wider font-semibold">Last Run</span>
                      <span className="text-sm text-secondary font-medium">
                        {s.lastRunAt ? formatDistanceToNow(new Date(s.lastRunAt), { addSuffix: true }) : "Never"}
                      </span>
                    </div>
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="text-xs text-tertiary uppercase tracking-wider font-semibold">Next Run</span>
                      <span className="text-sm text-brand font-medium">
                        {s.active && s.nextRunAt ? formatDistanceToNow(new Date(s.nextRunAt), { addSuffix: true }) : "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button 
                    className={`btn ${s.active ? "btn-ghost" : "btn-secondary"} btn-icon`}
                    onClick={() => onToggle(s.id, s.active)}
                    title={s.active ? "Pause Schedule" : "Resume Schedule"}
                  >
                    {s.active ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <button 
                    className="btn btn-ghost btn-icon text-err"
                    onClick={() => onDelete(s.id)}
                    title="Delete Schedule"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .schedule-card {
          transition: all 0.2s ease;
          border-left: 3px solid var(--brand);
        }
        .schedule-card.inactive {
          border-left-color: var(--text-tertiary);
          opacity: 0.7;
        }
        .border-color-subtle {
          border-color: rgba(255,255,255,0.05);
        }
        .badge-outline {
          background: rgba(34, 211, 238, 0.1);
          color: var(--brand-light);
          border: 1px solid rgba(34, 211, 238, 0.22);
          font-family: var(--font-mono);
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}
