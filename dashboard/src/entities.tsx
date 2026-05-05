export const ENTITY_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  Product:      { color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.3)" },
  Article:      { color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.3)" },
  Organization: { color: "#a855f7", bg: "rgba(168,85,247,0.12)",  border: "rgba(168,85,247,0.3)" },
  Organisation: { color: "#a855f7", bg: "rgba(168,85,247,0.12)",  border: "rgba(168,85,247,0.3)" },
  Person:       { color: "#f472b6", bg: "rgba(244,114,182,0.12)", border: "rgba(244,114,182,0.3)" },
  Location:     { color: "#22c55e", bg: "rgba(34,197,94,0.12)",   border: "rgba(34,197,94,0.3)" },
  Concept:      { color: "#818cf8", bg: "rgba(129,140,248,0.12)", border: "rgba(129,140,248,0.3)" },
  Technology:   { color: "#38bdf8", bg: "rgba(56,189,248,0.12)",  border: "rgba(56,189,248,0.3)" },
  Event:        { color: "#fb923c", bg: "rgba(251,146,60,0.12)",  border: "rgba(251,146,60,0.3)" },
  FAQPage:      { color: "#34d399", bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.3)" },
  WebPage:      { color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.2)" },
};

export function entityStyle(type?: string) {
  return ENTITY_STYLES[type || "WebPage"] ?? ENTITY_STYLES.WebPage;
}

export function EntityTag({ type }: { type: string }) {
  const s = entityStyle(type);
  return (
    <span
      className="etag"
      style={{ ["--et-color" as any]: s.color, ["--et-bg" as any]: s.bg, ["--et-border" as any]: s.border }}
    >
      {type}
    </span>
  );
}
