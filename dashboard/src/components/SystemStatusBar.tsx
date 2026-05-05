import { useEffect, useState } from "react";
import { getSystemHealth, type SystemHealth } from "../api";

type DotState = "ok" | "err" | "unknown";

const ITEMS: { key: keyof SystemHealth; label: string }[] = [
  { key: "api",    label: "API"    },
  { key: "db",     label: "DB"     },
  { key: "redis",  label: "Cache"  },
  { key: "worker", label: "Worker" },
  { key: "ai",     label: "AI"     },
];

export default function SystemStatusBar() {
  const [health, setHealth] = useState<SystemHealth | null>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const h = await getSystemHealth();
        if (alive) setHealth(h);
      } catch {
        if (alive) setHealth(null);
      }
    };
    check();
    const t = setInterval(check, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const anyErr = health !== null && ITEMS.some(({ key }) => !health[key]);

  return (
    <div className={`sys-status-bar ${anyErr ? "has-err" : ""}`} title="System health">
      {ITEMS.map(({ key, label }) => {
        const state: DotState = health === null ? "unknown" : health[key] ? "ok" : "err";
        const tip = `${label}: ${state === "unknown" ? "checking…" : state === "ok" ? "Online" : "Offline"}`;
        return (
          <div key={key} className={`sys-dot sys-dot--${state}`} title={tip}>
            <span className="sys-dot-light" />
            <span className="sys-dot-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
