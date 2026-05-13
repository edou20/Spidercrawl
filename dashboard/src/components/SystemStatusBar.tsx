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

const HEALTH_BOOL_KEYS: (keyof SystemHealth)[] = ["api", "db", "redis", "worker", "ai"];

function aiStatusLabel(health: SystemHealth): string {
  if (!health.ai) return "AI";
  if (health.activeProvider === "openrouter") return "OpenRouter";
  if (health.activeProvider === "gemini") return "Gemini";
  if (health.activeProvider === "openai-compatible") return "AI · custom";
  if (health.activeProvider === "openai") return "OpenAI";
  return "AI";
}

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

  const anyErr =
    health !== null && HEALTH_BOOL_KEYS.some((key) => !health[key]);

  return (
    <div className={`sys-status-bar ${anyErr ? "has-err" : ""}`} title="System health">
      {ITEMS.map(({ key, label }) => {
        const state: DotState = health === null ? "unknown" : health[key] ? "ok" : "err";
        const displayLabel = key === "ai" ? aiStatusLabel(health ?? ({} as SystemHealth)) : label;
        const tipParts = [
          `${displayLabel}: ${state === "unknown" ? "checking…" : state === "ok" ? "Online" : "Offline"}`,
        ];
        if (key === "ai" && health?.openAi?.chatModel) {
          tipParts.push(`${health.openAi.gateway} · ${health.openAi.chatModel}`);
        }
        const tip = tipParts.join(" — ");
        return (
          <div key={key} className={`sys-dot sys-dot--${state}`} title={tip}>
            <span className="sys-dot-light" />
            <span className="sys-dot-label">{displayLabel}</span>
          </div>
        );
      })}
    </div>
  );
}
