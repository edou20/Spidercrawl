import { useEffect, useRef, useState, useCallback } from "react";
import * as d3force from "d3-force";
import { ZoomIn, ZoomOut, Maximize2, MousePointer2 } from "lucide-react";

export interface GNode {
  id: string;
  label: string;
  color: string;
  size: number;
  type?: "page" | "entity";
}
export interface GEdge { source: string; target: string; }

interface Props {
  nodes: GNode[];
  edges: GEdge[];
  width: number;
  height: number;
  onNodeClick?: (id: string) => void;
  selectedNodeId?: string | null;
}

interface SimNode extends d3force.SimulationNodeDatum {
  id: string; label: string; color: string; size: number; type?: "page" | "entity";
}
interface SimLink extends d3force.SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
  particles: { t: number; speed: number }[];
}

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    i === 0 ? ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a))
             : ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
}

function bezierCtrl(sx: number, sy: number, tx: number, ty: number) {
  const mx = (sx + tx) / 2, my = (sy + ty) / 2;
  const dx = tx - sx, dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const off = Math.min(len * 0.22, 45);
  return { cx: mx - (dy / len) * off, cy: my + (dx / len) * off };
}

function bezierPt(sx: number, sy: number, cx: number, cy: number, tx: number, ty: number, t: number) {
  const mt = 1 - t;
  return { x: mt*mt*sx + 2*mt*t*cx + t*t*tx, y: mt*mt*sy + 2*mt*t*cy + t*t*ty };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export default function ForceGraph({ nodes, edges, width, height, onNodeClick, selectedNodeId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: SimNode } | null>(null);

  // Refs so animation loop reads latest values without restarting simulation
  const selectedRef = useRef(selectedNodeId);
  const zoomActionsRef = useRef<{ zoomIn: () => void; zoomOut: () => void; reset: () => void } | null>(null);
  useEffect(() => { selectedRef.current = selectedNodeId; }, [selectedNodeId]);

  const simRef = useRef<d3force.Simulation<SimNode, SimLink> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);
  const animFrameRef = useRef<number>(0);

  if (nodes.length === 0) {
    return (
      <div className="graph-empty-state" style={{ width, height }}>
        <div className="graph-empty-state__title">Graph will appear when crawl relationships are available.</div>
        <div className="graph-empty-state__body">
          Load page links or entity extraction to see the crawl topology and connected concepts.
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // ── 1. Update or Initialize Simulation ────────────────────
    if (!simRef.current) {
      simNodesRef.current = nodes.map(n => ({ ...n }));
      const nodeById = new Map(simNodesRef.current.map(n => [n.id, n]));
      
      simLinksRef.current = edges
        .filter(e => nodeById.has(e.source) && nodeById.has(e.target))
        .map(e => ({
          source: e.source,
          target: e.target,
          particles: Array.from({ length: 2 }, () => ({
            t: Math.random(),
            speed: 0.0015 + Math.random() * 0.0025,
          })),
        }));

      simRef.current = d3force.forceSimulation<SimNode>(simNodesRef.current)
        .force("link", d3force.forceLink<SimNode, SimLink>(simLinksRef.current).id(d => d.id).distance(85).strength(0.4))
        .force("charge", d3force.forceManyBody<SimNode>().strength(n => (n.type === "entity" ? -190 : -145) - n.size * 6))
        .force("center", d3force.forceCenter(width / 2, height / 2).strength(0.06))
        .force("collision", d3force.forceCollide<SimNode>().radius(d => d.size + 12))
        .force("x", d3force.forceX<SimNode>((d) => d.type === "entity" ? width * 0.64 : width * 0.38).strength(0.08))
        .force("y", d3force.forceY<SimNode>((d) => d.type === "entity" ? height * 0.47 : height * 0.53).strength(0.05))
        .alphaDecay(0.045);
    } else {
      // Incremental Update
      const existingNodes = new Map(simNodesRef.current.map(n => [n.id, n]));
      const newSimNodes = nodes.map(n => {
        const existing = existingNodes.get(n.id);
        if (existing) {
          // Update props but keep coordinates
          existing.label = n.label;
          existing.color = n.color;
          existing.size = n.size;
          existing.type = n.type;
          return existing;
        }
        return { ...n };
      });

      simNodesRef.current = newSimNodes;
      const nodeById = new Map(simNodesRef.current.map(n => [n.id, n]));
      
      simLinksRef.current = edges
        .filter(e => nodeById.has(e.source) && nodeById.has(e.target))
        .map(e => {
          // Try to find existing link to preserve particles
          const existing = simLinksRef.current.find(l => 
            (typeof l.source === 'string' ? l.source : l.source.id) === e.source && 
            (typeof l.target === 'string' ? l.target : l.target.id) === e.target
          );
          if (existing) return existing;
          return {
            source: e.source,
            target: e.target,
            particles: Array.from({ length: 2 }, () => ({
              t: Math.random(),
              speed: 0.0015 + Math.random() * 0.0025,
            })),
          };
        });

      simRef.current.nodes(simNodesRef.current);
      (simRef.current.force("link") as any).links(simLinksRef.current);
      simRef.current.alpha(0.3).restart();
    }

    const transform = { x: 0, y: 0, k: 1 };
    let dragging: SimNode | null = null;
    let panning = false;
    let panStart = { x: 0, y: 0, tx: 0, ty: 0 };
    let hoveredNode: SimNode | null = null;
    let pulse = 0;

    const fitToGraph = () => {
      const positioned = simNodesRef.current.filter((n) => n.x != null && n.y != null);
      if (positioned.length === 0) {
        transform.x = 0; transform.y = 0; transform.k = 1;
        return;
      }

      const minX = Math.min(...positioned.map((n) => n.x!));
      const maxX = Math.max(...positioned.map((n) => n.x!));
      const minY = Math.min(...positioned.map((n) => n.y!));
      const maxY = Math.max(...positioned.map((n) => n.y!));
      const padding = 72;
      const graphW = Math.max(1, maxX - minX);
      const graphH = Math.max(1, maxY - minY);
      const scale = Math.min(
        1.25,
        Math.max(0.18, Math.min((width - padding * 2) / graphW, (height - padding * 2) / graphH))
      );

      transform.k = scale;
      transform.x = width / 2 - ((minX + maxX) / 2) * scale;
      transform.y = height / 2 - ((minY + maxY) / 2) * scale;
    };

    // Expose zoom controls
    zoomActionsRef.current = {
      zoomIn: () => {
        const f = 1.3;
        transform.x = width/2 - (width/2 - transform.x) * f;
        transform.y = height/2 - (height/2 - transform.y) * f;
        transform.k = Math.min(4, transform.k * f);
      },
      zoomOut: () => {
        const f = 0.77;
        transform.x = width/2 - (width/2 - transform.x) * f;
        transform.y = height/2 - (height/2 - transform.y) * f;
        transform.k = Math.max(0.1, transform.k * f);
      },
      reset: fitToGraph,
    };

    const fitTimer = window.setTimeout(fitToGraph, 650);

    const toWorld = (cx: number, cy: number) => ({
      x: (cx - transform.x) / transform.k,
      y: (cy - transform.y) / transform.k,
    });

    function getNeighbors(id: string | null | undefined) {
      const s = new Set<string>();
      if (!id) return s;
      for (const l of simLinksRef.current) {
        const src = (typeof l.source === "string" ? l.source : l.source.id);
        const tgt = (typeof l.target === "string" ? l.target : l.target.id);
        if (src === id) s.add(tgt);
        if (tgt === id) s.add(src);
      }
      return s;
    }

    function animate() {
      pulse += 0.055;
      const sel = selectedRef.current;
      const neighbors = getNeighbors(sel);

      for (const l of simLinksRef.current) {
        const s = l.source as SimNode, t = l.target as SimNode;
        if (s.x == null || t.x == null) continue;
        for (const p of l.particles) { p.t += p.speed; if (p.t > 1) p.t = 0; }
      }

      ctx.clearRect(0, 0, width, height);
      // Inline drawBg/Edge/Node for performance or access to local vars
      drawBg(ctx, width, height, transform);
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      for (const l of simLinksRef.current) drawEdge(ctx, l, neighbors, sel);
      
      // Sorted draw for depth
      const sortedNodes = [...simNodesRef.current].sort((a, b) => {
        const aDim = sel != null && sel !== a.id && !neighbors.has(a.id);
        const bDim = sel != null && sel !== b.id && !neighbors.has(b.id);
        if (aDim && !bDim) return -1;
        if (!aDim && bDim) return 1;
        return 0;
      });

      for (const n of sortedNodes) drawNode(ctx, n, neighbors, sel, pulse, transform, hoveredNode);

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(animate);
    }

    animate();

    // ── Interaction Listeners ─────────────────────────────────
    function hitTest(cx: number, cy: number): SimNode | null {
      const { x, y } = toWorld(cx, cy);
      for (let i = simNodesRef.current.length - 1; i >= 0; i--) {
        const n = simNodesRef.current[i];
        if (n.x == null) continue;
        const dx = n.x - x, dy = n.y! - y;
        if (Math.sqrt(dx*dx + dy*dy) < (n.size||6) + 7) return n;
      }
      return null;
    }

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.14 : 0.88;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      transform.x = mx - (mx - transform.x) * f;
      transform.y = my - (my - transform.y) * f;
      transform.k = Math.min(5, Math.max(0.08, transform.k * f));
    };

    let clickPos = { x: 0, y: 0 };
    const onMousedown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      clickPos = { x: mx, y: my };
      const hit = hitTest(mx, my);
      if (hit) {
        dragging = hit; hit.fx = hit.x; hit.fy = hit.y;
        canvas.style.cursor = "grabbing";
      } else {
        panning = true;
        panStart = { x: mx, y: my, tx: transform.x, ty: transform.y };
        canvas.style.cursor = "grab";
      }
    };

    const onMousemove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;

      if (dragging) {
        const { x, y } = toWorld(mx, my);
        dragging.fx = x; dragging.fy = y;
        simRef.current?.alphaTarget(0.3).restart();
      } else if (panning) {
        transform.x = panStart.tx + (mx - panStart.x);
        transform.y = panStart.ty + (my - panStart.y);
        canvas.style.cursor = "grabbing";
      } else {
        const hov = hitTest(mx, my);
        if (hov !== hoveredNode) {
          hoveredNode = hov;
          canvas.style.cursor = hov ? "pointer" : "default";
        }
        if (hov) setTooltip({ x: mx, y: my, node: hov });
        else setTooltip(null);
      }
    };

    const onMouseup = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const dist = Math.sqrt((mx - clickPos.x) ** 2 + (my - clickPos.y) ** 2);
      if (dragging) {
        if (dist < 5) onNodeClick?.(dragging.id);
        dragging.fx = null; dragging.fy = null;
        dragging = null;
        simRef.current?.alphaTarget(0);
      }
      panning = false;
      canvas.style.cursor = "default";
    };

    const onMouseleave = () => {
      hoveredNode = null; setTooltip(null); panning = false;
      if (dragging) { dragging.fx = null; dragging.fy = null; dragging = null; simRef.current?.alphaTarget(0); }
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onMousedown);
    canvas.addEventListener("mousemove", onMousemove);
    canvas.addEventListener("mouseup", onMouseup);
    canvas.addEventListener("mouseleave", onMouseleave);
    return () => {
      window.clearTimeout(fitTimer);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onMousedown);
      canvas.removeEventListener("mousemove", onMousemove);
      canvas.removeEventListener("mouseup", onMouseup);
      canvas.removeEventListener("mouseleave", onMouseleave);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [nodes, edges, width, height]);

  // ── Drawing Helpers ───────────────────────────────────────
  function drawBg(ctx: CanvasRenderingContext2D, width: number, height: number, transform: any) {
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#08111f");
    bg.addColorStop(0.45, "#091426");
    bg.addColorStop(1, "#050914");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    const accent = ctx.createRadialGradient(width * 0.18, height * 0.2, 0, width * 0.18, height * 0.2, width * 0.7);
    accent.addColorStop(0, "rgba(34,211,238,0.12)");
    accent.addColorStop(1, "transparent");
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, width, height);
    const accent2 = ctx.createRadialGradient(width * 0.82, height * 0.18, 0, width * 0.82, height * 0.18, width * 0.62);
    accent2.addColorStop(0, "rgba(99,102,241,0.12)");
    accent2.addColorStop(1, "transparent");
    ctx.fillStyle = accent2;
    ctx.fillRect(0, 0, width, height);
    const vig = ctx.createRadialGradient(width/2, height/2, height*0.15, width/2, height/2, height*0.9);
    vig.addColorStop(0, "rgba(4,8,18,0)");
    vig.addColorStop(1, "rgba(1,3,10,0.58)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);
    const step = 22 * transform.k;
    const ox = ((transform.x % step) + step) % step;
    const oy = ((transform.y % step) + step) % step;
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    for (let gx = ox - step; gx < width + step; gx += step) {
      for (let gy = oy - step; gy < height + step; gy += step) {
        ctx.beginPath(); ctx.arc(gx, gy, 0.85, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawEdge(ctx: CanvasRenderingContext2D, link: SimLink, neighbors: Set<string>, sel: string | null | undefined) {
    const s = link.source as SimNode, t = link.target as SimNode;
    if (s.x == null || t.x == null) return;
    const { cx, cy } = bezierCtrl(s.x!, s.y!, t.x!, t.y!);
    const isConn = sel != null && (s.id === sel || t.id === sel);
    const dimmed = sel != null && !isConn;
    ctx.globalAlpha = dimmed ? 0.04 : 1;
    ctx.beginPath(); ctx.moveTo(s.x!, s.y!); ctx.quadraticCurveTo(cx, cy, t.x!, t.y!);
    if (isConn) {
      const grad = ctx.createLinearGradient(s.x!, s.y!, t.x!, t.y!);
      grad.addColorStop(0, s.color + "88"); grad.addColorStop(1, t.color + "88");
      ctx.strokeStyle = grad; ctx.lineWidth = 1.6;
    } else {
      ctx.strokeStyle = "rgba(148,163,184,0.18)"; ctx.lineWidth = 0.9;
    }
    ctx.stroke();
    const ap = bezierPt(s.x!, s.y!, cx, cy, t.x!, t.y!, 0.82);
    const ap2 = bezierPt(s.x!, s.y!, cx, cy, t.x!, t.y!, 0.87);
    const angle = Math.atan2(ap2.y - ap.y, ap2.x - ap.x);
    ctx.save(); ctx.translate(ap.x, ap.y); ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8, -3.5); ctx.lineTo(-8, 3.5); ctx.closePath();
    ctx.fillStyle = isConn ? "rgba(148,163,184,0.65)" : "rgba(148,163,184,0.14)";
    ctx.fill(); ctx.restore();
    if (!dimmed) {
      for (const p of link.particles) {
        const pt = bezierPt(s.x!, s.y!, cx, cy, t.x!, t.y!, p.t);
        const pr = isConn ? 2.2 : 1.4;
        const color = isConn ? s.color : "#94a3b8";
        const pgrd = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, pr * 3.5);
        pgrd.addColorStop(0, color + "cc"); pgrd.addColorStop(1, "transparent");
        ctx.globalAlpha = isConn ? 0.85 : 0.35;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, pr * 3.5, 0, Math.PI * 2); ctx.fillStyle = pgrd; ctx.fill();
        ctx.globalAlpha = isConn ? 1 : 0.5;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, pr, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawNode(ctx: CanvasRenderingContext2D, node: SimNode, neighbors: Set<string>, sel: string | null | undefined, ph: number, transform: any, hoveredNode: any) {
    if (node.x == null) return;
    const r = node.size || 6;
    const isSel = sel === node.id;
    const isNeighbor = neighbors.has(node.id);
    const isHov = hoveredNode?.id === node.id;
    const dimmed = sel != null && !isSel && !isNeighbor;
    const isPage = !node.type || node.type === "page";
    ctx.globalAlpha = dimmed ? 0.15 : 1;
    const glowR = r * (isSel ? 5.5 : isHov ? 4.5 : 3.2);
    const atm = ctx.createRadialGradient(node.x!, node.y!, 0, node.x!, node.y!, glowR);
    atm.addColorStop(0, node.color + (isSel ? "44" : isHov ? "38" : "22"));
    atm.addColorStop(0.5, node.color + (isSel ? "18" : "0a"));
    atm.addColorStop(1, "transparent");
    ctx.beginPath(); ctx.arc(node.x!, node.y!, glowR, 0, Math.PI * 2); ctx.fillStyle = atm; ctx.fill();
    if (isSel) {
      for (let ring = 0; ring < 2; ring++) {
        const rr = r + 7 + ring * 6 + Math.sin(ph + ring * 1.2) * 2.5;
        ctx.beginPath(); ctx.arc(node.x!, node.y!, rr, 0, Math.PI * 2);
        ctx.strokeStyle = node.color + (ring === 0 ? "55" : "22"); ctx.lineWidth = ring === 0 ? 1.5 : 1; ctx.stroke();
      }
    }
    if (isHov && !isSel) {
      ctx.beginPath(); ctx.arc(node.x!, node.y!, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = node.color + "44"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    const fillGrd = ctx.createRadialGradient(node.x! - r * 0.32, node.y! - r * 0.32, 0, node.x!, node.y!, r * 1.1);
    fillGrd.addColorStop(0, node.color + "ff"); fillGrd.addColorStop(0.55, node.color + "cc"); fillGrd.addColorStop(1, node.color + "77");
    if (isPage) { ctx.beginPath(); ctx.arc(node.x!, node.y!, r, 0, Math.PI * 2); } else hexPath(ctx, node.x!, node.y!, r);
    ctx.fillStyle = fillGrd; ctx.fill();
    if (isPage) { ctx.beginPath(); ctx.arc(node.x!, node.y!, r, 0, Math.PI * 2); } else hexPath(ctx, node.x!, node.y!, r);
    ctx.strokeStyle = isSel ? "#ffffff" : (isHov ? node.color + "ff" : node.color + "99");
    ctx.lineWidth = isSel ? 2.2 : 1.3; ctx.stroke();
    if (r > 5) {
      ctx.beginPath(); ctx.arc(node.x! - r * 0.3, node.y! - r * 0.3, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.38)"; ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (transform.k > 0.32 || isSel || isHov) {
      ctx.font = `${isSel ? 11 : 10}px Inter,system-ui,sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      let label = node.label; const maxW = 100;
      if (ctx.measureText(label).width > maxW) {
        while (ctx.measureText(label + "…").width > maxW && label.length > 2) label = label.slice(0, -1);
        label += "…";
      }
      const tw = ctx.measureText(label).width, lx = node.x!, ly = node.y! + r + 14, pad = 5, h = 14;
      ctx.globalAlpha = dimmed ? 0.15 : (isSel ? 1 : 0.85); ctx.fillStyle = "rgba(7,9,15,0.78)";
      roundRect(ctx, lx - tw/2 - pad, ly - h/2 - 1, tw + pad*2, h + 2, 4); ctx.fill();
      ctx.fillStyle = isSel ? "#f1f5f9" : (isHov ? "#cbd5e1" : "#64748b"); ctx.fillText(label, lx, ly); ctx.globalAlpha = 1;
    }
  }

  const zoomIn  = useCallback(() => zoomActionsRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => zoomActionsRef.current?.zoomOut(), []);
  const reset   = useCallback(() => zoomActionsRef.current?.reset(), []);

  const pageCount   = nodes.filter(n => !n.type || n.type === "page").length;
  const entityCount = nodes.filter(n => n.type === "entity").length;

  return (
    <div style={{ position: "relative", width, height, overflow: "hidden", borderRadius: "0 0 var(--r-lg) var(--r-lg)" }}>
      <canvas ref={canvasRef} style={{ width, height, display: "block" }} />

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: "absolute",
          left: Math.min(tooltip.x + 14, width - 220),
          top: Math.max(tooltip.y - 48, 8),
          background: "rgba(10,14,22,0.96)",
          border: "1px solid rgba(148,163,184,0.18)",
          borderRadius: 9,
          padding: "9px 13px",
          pointerEvents: "none",
          backdropFilter: "blur(12px)",
          maxWidth: 220,
          zIndex: 20,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#f1f5f9", marginBottom: 3, lineHeight: 1.35 }}>
            {tooltip.node.label}
          </div>
          <div style={{
            fontSize: 10,
            color: "#475569",
            fontFamily: "var(--font-mono)",
            wordBreak: "break-all",
            lineHeight: 1.4,
          }}>
            {tooltip.node.type === "entity" ? "Entity node" : tooltip.node.id.slice(0, 60) + (tooltip.node.id.length > 60 ? "…" : "")}
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6,
            fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            <span style={{
              display: "inline-block", width: 7, height: 7, borderRadius: "50%",
              background: tooltip.node.color,
              boxShadow: `0 0 6px ${tooltip.node.color}`,
            }} />
            <span style={{ color: "#64748b" }}>
              {tooltip.node.type === "entity" ? "Entity" : "Page"}
            </span>
          </div>
        </div>
      )}

      {/* Zoom controls */}
      <div style={{
        position: "absolute", bottom: 16, right: 16,
        display: "flex", flexDirection: "column", gap: 4, zIndex: 10,
      }}>
        {[
          { icon: <ZoomIn size={13} />, action: zoomIn, title: "Zoom in" },
          { icon: <ZoomOut size={13} />, action: zoomOut, title: "Zoom out" },
          { icon: <Maximize2 size={12} />, action: reset, title: "Fit graph to screen" },
        ].map(({ icon, action, title }) => (
          <button
            key={title}
            title={title}
            onClick={action}
            style={{
              width: 30, height: 30, borderRadius: 7,
              background: "rgba(10,14,22,0.85)",
              border: "1px solid rgba(148,163,184,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "#64748b",
              backdropFilter: "blur(8px)",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#cbd5e1"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(148,163,184,0.35)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#64748b"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(148,163,184,0.15)"; }}
          >
            {icon}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 16, left: 16,
        display: "flex", gap: 12, alignItems: "center",
        background: "rgba(10,14,22,0.75)",
        border: "1px solid rgba(148,163,184,0.12)",
        borderRadius: 8, padding: "6px 12px",
        backdropFilter: "blur(8px)",
        fontSize: 11, color: "#475569",
        zIndex: 10,
      }}>
        {pageCount > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#38bdf8" opacity="0.85" /></svg>
            <span>{pageCount} page{pageCount !== 1 ? "s" : ""}</span>
          </span>
        )}
        {entityCount > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="12" height="11" viewBox="0 0 12 11">
              <polygon points="6,0.5 11,3 11,8 6,10.5 1,8 1,3" fill="#a78bfa" opacity="0.85" />
            </svg>
            <span>{entityCount} entit{entityCount !== 1 ? "ies" : "y"}</span>
          </span>
        )}
        <span style={{ color: "#334155" }}>·</span>
        <span>{edges.length} relationship{edges.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Interaction hint */}
      <div style={{
        position: "absolute", top: 14, right: 14,
        display: "inline-flex", alignItems: "center", gap: 7,
        background: "rgba(10,14,22,0.72)",
        border: "1px solid rgba(148,163,184,0.12)",
        borderRadius: 8, padding: "6px 10px",
        backdropFilter: "blur(8px)",
        fontSize: 10.5, color: "#64748b",
        zIndex: 10,
      }}>
        <MousePointer2 size={11} />
        <span>Drag to pan · buttons to zoom · reset if lost</span>
      </div>
    </div>
  );
}
