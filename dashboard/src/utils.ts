export function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function hostname(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

export function pathname(u: string) {
  try { const x = new URL(u); return x.pathname + (x.search || ""); } catch { return u; }
}

export function shortPath(u: string) {
  try {
    const x = new URL(u);
    const p = x.pathname === "/" ? "" : x.pathname;
    return x.hostname.replace(/^www\./, "") + p;
  } catch { return u; }
}
