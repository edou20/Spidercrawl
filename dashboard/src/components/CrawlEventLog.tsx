import { useRef, useEffect } from "react";
import { CheckCircle2, XCircle, SkipForward, Globe, Play, AlertTriangle, Zap } from "lucide-react";
import type { CrawlEvent } from "../api";
import { hostname, pathname, timeAgo } from "../utils";

interface Props {
  events: CrawlEvent[];
  connected?: boolean;
  autoScroll?: boolean;
}

interface EventMeta {
  icon: React.ReactNode;
  label: string;
  color: string;
  badgeClass: string;
}

function eventMeta(type: string): EventMeta {
  switch (type) {
    case "job.started":
      return { icon: <Play size={11} />, label: "Started", color: "var(--brand)", badgeClass: "badge-processing" };
    case "job.completed":
      return { icon: <CheckCircle2 size={11} />, label: "Completed", color: "var(--green)", badgeClass: "badge-completed" };
    case "job.failed":
      return { icon: <XCircle size={11} />, label: "Failed", color: "var(--red)", badgeClass: "badge-failed" };
    case "job.progress":
      return { icon: <Zap size={11} />, label: "Progress", color: "var(--brand)", badgeClass: "badge-processing" };
    case "page.crawled":
      return { icon: <Globe size={11} />, label: "Crawled", color: "var(--text-secondary)", badgeClass: "badge-completed" };
    case "page.skipped":
      return { icon: <SkipForward size={11} />, label: "Skipped", color: "var(--text-tertiary)", badgeClass: "badge-ghost" };
    case "page.failed":
      return { icon: <XCircle size={11} />, label: "Page Error", color: "var(--red)", badgeClass: "badge-failed" };
    case "link.scored":
      return { icon: <Zap size={11} />, label: "Link Scored", color: "#a78bfa", badgeClass: "badge-ghost" };
    default:
      return { icon: <AlertTriangle size={11} />, label: type, color: "var(--text-tertiary)", badgeClass: "badge-ghost" };
  }
}

function formatData(type: string, data: Record<string, unknown>): string | null {
  if (type === "page.crawled") {
    const parts: string[] = [];
    if (data.statusCode) parts.push(`HTTP ${data.statusCode}`);
    if (data.depth !== undefined) parts.push(`depth ${data.depth}`);
    if (data.elapsedMs) parts.push(`${data.elapsedMs}ms`);
    if (data.linksFound) parts.push(`${data.linksFound} links`);
    if (data.hasExtracted) parts.push("extracted");
    return parts.join(" · ") || null;
  }
  if (type === "page.failed" && data.error) return String(data.error).slice(0, 120);
  if (type === "job.started") {
    const parts: string[] = [];
    if (data.maxPages) parts.push(`max ${data.maxPages} pages`);
    if (data.goal) parts.push(`goal: "${String(data.goal).slice(0, 60)}"`);
    return parts.join(" · ") || null;
  }
  if (type === "job.completed" || type === "job.failed") {
    const parts: string[] = [];
    if (data.completedPages) parts.push(`${data.completedPages} pages`);
    if (data.satisfactionScore) parts.push(`score ${(Number(data.satisfactionScore) * 100).toFixed(0)}%`);
    if (data.error) parts.push(String(data.error).slice(0, 100));
    return parts.join(" · ") || null;
  }
  if (type === "page.skipped" && data.reason) return `reason: ${data.reason}`;
  return null;
}

export default function CrawlEventLog({ events, connected = false, autoScroll = true }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [events.length, autoScroll]);

  if (events.length === 0) {
    return (
      <div className="empty-state" style={{ padding: "40px 0" }}>
        <Zap style={{ width: 32, height: 32, color: "var(--text-tertiary)" }} />
        <h3 style={{ marginTop: 12 }}>No events yet</h3>
        <p>{connected ? "Waiting for crawl activity…" : "Start a crawl to see live events here."}</p>
      </div>
    );
  }

  return (
    <div className="event-log">
      <div className="event-log-list">
        {events.map((ev, i) => {
          const meta = eventMeta(ev.type);
          const detail = formatData(ev.type, ev.data);
          return (
            <div key={ev.id ?? i} className={`event-row event-row--${ev.type.replace(".", "-")}`}>
              <div className="event-row-line" />
              <div className="event-row-dot" style={{ background: meta.color }} />
              <div className="event-row-body">
                <div className="event-row-header">
                  <span className={`badge ${meta.badgeClass}`} style={{ gap: 4 }}>
                    {meta.icon}
                    {meta.label}
                  </span>
                  {ev.url && (
                    <span className="event-row-url font-mono text-xs text-tertiary truncate">
                      {hostname(ev.url)}{pathname(ev.url)}
                    </span>
                  )}
                  <span className="event-row-ts text-xs text-tertiary shrink-0">
                    {timeAgo(ev.ts)}
                  </span>
                </div>
                {detail && (
                  <div className="event-row-detail text-xs text-tertiary">{detail}</div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
