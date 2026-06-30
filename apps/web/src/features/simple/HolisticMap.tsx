/** Holistic Simple View — ONE cohesive canvas of the whole system (no drill).
 *
 *  Compiler pipeline (Mermaid-compiler style): SystemMap DTO (graph projection) →
 *  ELK compound graph (each feature = a cluster; cross-feature edges between clusters)
 *  → ELK Layered layout (elkjs, INCLUDE_CHILDREN, model-order = deterministic) →
 *  custom SVG render with a legible flowchart GRAMMAR + pan/zoom/fit. ELK is lazy-loaded.
 *
 *  Grammar (one silhouette + one token per meaning — no chips, no slop):
 *    decision (sign-in check) = diamond · operation (a thing you can do) = rect with a
 *    left ink rule · state (a lifecycle phase) = stadium · data (what it stores) = rect
 *    with a double top line · external (an outside service) = dashed-border rect.
 *  Relationships by line style: needs = solid · works-with (mutual) = dashed · notifies = dotted. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SystemMap, FlowNode, FlowNodeKind } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type XY = { x: number; y: number };
type ElkNode = {
  id: string;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: ElkEdge[];
  x?: number;
  y?: number;
  _kind?: FlowNodeKind;
  _label?: string;
  _title?: string;
  _summary?: string;
  _access?: "writes" | "reads";
};
type ElkEdge = {
  id: string;
  sources: string[];
  targets: string[];
  _label?: string;
  _mutual?: boolean;
  sections?: { startPoint: XY; endPoint: XY; bendPoints?: XY[] }[];
};

/** Deterministic ≤2-line word wrap (never amputate — grow the box instead). */
function wrapLabel(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) { lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  if (lines.length <= 2) return lines;
  const tail = lines.slice(1).join(" ");
  return [lines[0], tail.length > max ? tail.slice(0, max - 1) + "…" : tail];
}

function nodeSize(n: FlowNode): { w: number; h: number; lines: string[] } {
  const max = n.kind === "decision" ? 15 : 18;
  const lines = wrapLabel(n.label, max);
  const longest = Math.max(...lines.map((l) => l.length));
  const pad = n.kind === "decision" ? 46 : 30;
  const w = clamp(longest * 7 + pad, 92, 196);
  const base = n.kind === "decision" ? 54 : 38;
  const h = lines.length > 1 ? base + 15 : base;
  return { w, h, lines };
}

/** SystemMap → ELK compound graph (deterministic; stable input order). */
function buildElkGraph(data: SystemMap): ElkNode {
  const clusters: ElkNode[] = data.features.map((f) => {
    const fg = f.flowGraph ?? { nodes: [], edges: [] };
    const children: ElkNode[] =
      fg.nodes.length > 0
        ? fg.nodes.map((n) => {
            const s = nodeSize(n);
            return { id: `${f.slug}::${n.id}`, width: s.w, height: s.h, _kind: n.kind, _label: n.label, _access: n.access };
          })
        : [{ id: `${f.slug}::_`, width: 150, height: 38, _kind: "process" as FlowNodeKind, _label: `${f.capabilityCount} things you can do` }];
    const edges: ElkEdge[] = fg.edges.map((e, i) => ({
      id: `${f.slug}::e${i}`,
      sources: [`${f.slug}::${e.from}`],
      targets: [`${f.slug}::${e.to}`],
    }));
    const kept = f.dataLabels.slice(0, 2).join(", ");
    const summary = `${f.capabilityCount} ${f.capabilityCount === 1 ? "thing" : "things"} you can do${kept ? ` · keeps ${kept}` : ""}`;
    return {
      id: `F::${f.slug}`,
      _title: f.title,
      _summary: summary,
      layoutOptions: { "elk.padding": "[top=40,left=18,bottom=18,right=18]", "elk.spacing.nodeNode": "24" },
      children,
      edges,
    };
  });

  const known = new Set(data.features.map((f) => `F::${f.slug}`));
  const cross: ElkEdge[] = data.arrows
    .filter((a) => known.has(`F::${a.from}`) && known.has(`F::${a.to}`))
    .map((a, i) => ({ id: `X${i}`, sources: [`F::${a.from}`], targets: [`F::${a.to}`], _label: a.label, _mutual: a.mutual }));

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.mergeEdges": "true",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      "elk.spacing.nodeNode": "56",
      "elk.spacing.edgeNode": "28",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: clusters,
    edges: cross,
  };
}

interface PNode { id: string; x: number; y: number; w: number; h: number; kind: FlowNodeKind; label: string; access?: "writes" | "reads" }
interface PCluster { id: string; x: number; y: number; w: number; h: number; title: string; summary: string }
interface PEdge { id: string; pts: XY[]; label?: string; mutual?: boolean; cross: boolean; from?: string; to?: string }
interface Laid { clusters: PCluster[]; nodes: PNode[]; edges: PEdge[]; w: number; h: number }

function flatten(root: ElkNode): Laid {
  const clusters: PCluster[] = [];
  const nodes: PNode[] = [];
  const edges: PEdge[] = [];
  for (const c of root.children ?? []) {
    const cx = c.x ?? 0, cy = c.y ?? 0;
    clusters.push({ id: c.id, x: cx, y: cy, w: c.width ?? 0, h: c.height ?? 0, title: c._title ?? "", summary: c._summary ?? "" });
    for (const n of c.children ?? []) {
      nodes.push({ id: n.id, x: cx + (n.x ?? 0), y: cy + (n.y ?? 0), w: n.width ?? 0, h: n.height ?? 0, kind: n._kind ?? "process", label: n._label ?? "", access: n._access });
    }
    for (const e of c.edges ?? []) {
      const sec = e.sections?.[0];
      if (!sec) continue;
      const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => ({ x: cx + p.x, y: cy + p.y }));
      edges.push({ id: e.id, pts, cross: false });
    }
  }
  for (const e of root.edges ?? []) {
    const sec = e.sections?.[0];
    if (!sec) continue;
    const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint];
    edges.push({ id: e.id, pts, label: e._label, mutual: e._mutual, cross: true, from: e.sources[0], to: e.targets[0] });
  }
  return { clusters, nodes, edges, w: root.width ?? 0, h: root.height ?? 0 };
}

/** Arc-length midpoint of a polyline (true middle — not pts[mid], which lands on a corner). */
function midpoint(pts: XY[]): XY {
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  let total = 0;
  const segs: number[] = [];
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(d); total += d; }
  let acc = 0;
  const half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= half) {
      const t = segs[i] === 0 ? 0 : (half - acc) / segs[i];
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    acc += segs[i];
  }
  return pts[Math.floor(pts.length / 2)];
}

export function HolisticMap({ data }: { data: SystemMap }) {
  const graph = useMemo(() => buildElkGraph(data), [data]);
  const stats = useMemo(() => {
    let things = 0, open = 0;
    const dataKinds = new Set<string>();
    const exts = new Set<string>();
    for (const f of data.features) {
      things += f.capabilities.length;
      for (const c of f.capabilities) if (c.actor === "Any user") open++;
      for (const d of f.dataLabels) dataKinds.add(d);
      for (const e of f.external ?? []) exts.add(e);
    }
    return { parts: data.features.length, things, open, dataKinds: dataKinds.size, exts: [...exts].sort() };
  }, [data]);
  const [laid, setLaid] = useState<Laid | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("elkjs/lib/elk.bundled.js");
        const ELK = mod.default;
        const elk = new ELK();
        const res = (await elk.layout(graph as never)) as unknown as ElkNode;
        if (!cancelled) setLaid(flatten(res));
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [graph]);

  // pan / zoom / fit
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const moved = useRef(false);

  // Click-to-trace + search: which clusters are "in focus" (full ink); rest dims.
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [present, setPresent] = useState(false);

  // Deterministic "worth a look" findings (security / orphan / dead-data smells).
  const findings = useMemo(() => {
    const out: string[] = [];
    const connected = new Set<string>();
    for (const a of data.arrows) { connected.add(a.from); connected.add(a.to); }
    for (const f of data.features) {
      if (f.capabilities.some((c) => c.actor === "Any user" && c.data.some((d) => d.access === "writes")))
        out.push(`${f.title}: anyone (not signed in) can change data`);
      if (f.dataLabels.length > 0 && f.capabilities.length === 0)
        out.push(`${f.title}: stores data but has no actions`);
      if (data.features.length > 1 && !connected.has(f.slug))
        out.push(`${f.title}: isn't connected to anything`);
    }
    return out;
  }, [data]);
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of laid?.edges ?? []) {
      if (!e.cross || !e.from || !e.to) continue;
      (m.get(e.from) ?? m.set(e.from, new Set()).get(e.from)!).add(e.to);
      (m.get(e.to) ?? m.set(e.to, new Set()).get(e.to)!).add(e.from);
    }
    return m;
  }, [laid]);
  const focusSet = useMemo<Set<string> | null>(() => {
    if (selected) { const s = new Set([selected]); for (const n of adjacency.get(selected) ?? []) s.add(n); return s; }
    const q = query.trim().toLowerCase();
    if (q && laid) { const s = new Set(laid.clusters.filter((c) => c.title.toLowerCase().includes(q)).map((c) => c.id)); return s.size ? s : new Set(["__none__"]); }
    return null;
  }, [selected, query, adjacency, laid]);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !laid || laid.w === 0) return;
    const cw = el.clientWidth, ch = el.clientHeight, pad = 56;
    const k = clamp(Math.min((cw - pad * 2) / laid.w, (ch - pad * 2) / laid.h), 0.3, 1.5);
    setView({ k, x: (cw - laid.w * k) / 2, y: (ch - laid.h * k) / 2 });
  }, [laid]);

  useEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    const onResize = () => fit();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") fit();
      if (e.key === "Escape") { setSelected(null); setQuery(""); setPresent(false); }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("resize", onResize); window.removeEventListener("keydown", onKey); };
  }, [fit]);

  const zoomBy = (factor: number) => {
    const el = wrapRef.current; if (!el) return;
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    setView((v) => { const k = clamp(v.k * factor, 0.3, 2.5); return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k }; });
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top, dy = e.deltaY;
    setView((v) => { const k = clamp(v.k * Math.exp(-dy * 0.0015), 0.3, 2.5); return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k }; });
  };
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; moved.current = false; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { const d = drag.current; if (!d) return; if (!moved.current && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) moved.current = true; const nx = d.vx + (e.clientX - d.x), ny = d.vy + (e.clientY - d.y); setView((v) => ({ ...v, x: nx, y: ny })); };
  const onUp = () => { drag.current = null; };
  const onBgClick = () => { if (!moved.current) { setSelected(null); setQuery(""); } };

  if (err) {
    return (
      <Centered>
        <span className="text-[color:var(--ink-soft)]">This map could not be drawn.</span>
        <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">Try adding a node to the diagram, or reopen this view.</span>
      </Centered>
    );
  }
  if (!laid) return <Centered>compiling the system map…</Centered>;

  // Semantic-zoom: zoomed OUT = clusters + a one-line summary; zoomed IN reveals the
  // inner operations/states/edges. Focus-dim spotlights a clicked or searched part.
  const detail = view.k >= 0.5;
  const DIM = 0.16;
  const clusterOpacity = (cid: string) => (!focusSet || focusSet.has(cid) ? 1 : DIM);
  const nodeOpacity = (id: string) => clusterOpacity(`F::${id.split("::")[0]}`);
  const crossEdgeOpacity = (e: PEdge) => (!focusSet ? 1 : e.from && e.to && focusSet.has(e.from) && focusSet.has(e.to) ? 1 : DIM);

  // Deterministic SVG export — full diagram, theme tokens resolved so the file stands alone.
  const exportSvg = () => {
    const svgEl = wrapRef.current?.querySelector("svg");
    if (!svgEl || !laid) return;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    const pad = 28;
    clone.setAttribute("viewBox", `${-pad} ${-pad} ${laid.w + pad * 2} ${laid.h + pad * 2}`);
    clone.setAttribute("width", String(laid.w + pad * 2));
    clone.setAttribute("height", String(laid.h + pad * 2));
    const g = clone.querySelector("g");
    if (g) g.removeAttribute("transform");
    clone.querySelectorAll<SVGElement>("[opacity]").forEach((el) => { if (Number(el.getAttribute("opacity")) === 0) el.remove(); });
    const cs = getComputedStyle(document.documentElement);
    const toks = ["--paper", "--paper-raised", "--paper-sunken", "--ink", "--ink-soft", "--ink-faint", "--accent", "--accent-wash", "--border"];
    const vars = toks.map((t) => `${t}:${cs.getPropertyValue(t).trim()}`).join(";");
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `:root{${vars}}text{font-family:ui-sans-serif,system-ui,sans-serif}`;
    clone.insertBefore(style, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "system-map.svg"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <svg className="absolute inset-0 h-full w-full overflow-visible" onClick={onBgClick}>
        <defs>
          <marker id="hm-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3.2" orient="auto">
            <path d="M0,0 L7.5,3.2 L0,6.4 Z" fill="var(--ink-soft)" />
          </marker>
          <marker id="hm-arrow-faint" markerWidth="8" markerHeight="8" refX="6.4" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="var(--ink-faint)" />
          </marker>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* cluster containers — clickable; focus-dim; one-line summary when zoomed out */}
          {laid.clusters.map((c) => {
            const sel = selected === c.id;
            return (
              <g key={c.id} opacity={clusterOpacity(c.id)} className="cursor-pointer transition-opacity duration-200"
                 onClick={(e) => { e.stopPropagation(); setSelected((s) => (s === c.id ? null : c.id)); }}>
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={14} fill="var(--paper-raised)" stroke={sel ? "var(--accent)" : "hsl(var(--border))"} strokeWidth={sel ? 1.7 : 1.2} />
                <line x1={c.x + 12} y1={c.y + 30} x2={c.x + c.w - 12} y2={c.y + 30} stroke="hsl(var(--border))" strokeWidth={1} opacity={0.7} />
                <text x={c.x + 15} y={c.y + 20} fontSize={13} fontWeight={600} fill="var(--ink)" style={{ fontFamily: "var(--font-sans, sans-serif)" }}>{c.title}</text>
                <text x={c.x + c.w / 2} y={c.y + c.h / 2 + 8} textAnchor="middle" fontSize={11.5} fill="var(--ink-soft)" opacity={detail ? 0 : 1} className="transition-opacity duration-200" style={{ fontFamily: "var(--font-sans, sans-serif)" }}>{c.summary}</text>
              </g>
            );
          })}
          {/* cross-cluster relationships — always visible (the system's structure) */}
          {laid.edges.filter((e) => e.cross).map((e) => (
            <g key={e.id} opacity={crossEdgeOpacity(e)} className="transition-opacity duration-200"><EdgeLine e={e} /></g>
          ))}
          {/* DETAIL layer — inner operations/states/edges + relationship labels; fades out when zoomed out */}
          <g opacity={detail ? 1 : 0} className="transition-opacity duration-200" style={{ pointerEvents: detail ? undefined : "none" }}>
            {laid.edges.filter((e) => !e.cross).map((e) => (
              <g key={e.id} opacity={nodeOpacity(e.id)}><EdgeLine e={e} /></g>
            ))}
            {laid.edges.filter((e) => e.cross && e.label).map((e) => {
              const m = midpoint(e.pts);
              return (
                <g key={`l${e.id}`} opacity={crossEdgeOpacity(e)}>
                  <rect x={m.x - e.label!.length * 3.2 - 3} y={m.y - 9} width={e.label!.length * 6.4 + 6} height={14} rx={3} fill="var(--paper)" opacity={0.92} />
                  <text x={m.x} y={m.y + 1.5} fontSize={10.5} textAnchor="middle" fill="var(--ink-soft)" style={{ fontFamily: "var(--font-sans, sans-serif)" }}>{e.label}</text>
                </g>
              );
            })}
            {laid.nodes.map((n) => (
              <g key={n.id} opacity={nodeOpacity(n.id)}><NodeShape n={n} /></g>
            ))}
          </g>
        </g>
      </svg>

      {/* Executive readout — one honest sentence over the system (chrome, never pans). */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-10 max-w-[78%] -translate-x-1/2 text-center">
        <p className="font-sans text-[13px] leading-snug text-[color:var(--ink)]">
          <b className="font-semibold tabular-nums">{stats.parts}</b> parts · <b className="font-semibold tabular-nums">{stats.things}</b> things people can do
          {stats.open > 0 && <> · <span className="tabular-nums">{stats.open}</span> open to anyone</>}
          {stats.dataKinds > 0 && <> · stores <span className="tabular-nums">{stats.dataKinds}</span> kinds of data</>}
          {stats.exts.length > 0 && <> · connects to {stats.exts.join(", ")}</>}
        </p>
        {data.shared && data.shared.items.length > 0 && (
          <p className="mt-0.5 font-mono text-[11px] text-[color:var(--ink-faint)]">Shared by every part: {data.shared.items.join(" · ")}</p>
        )}
      </div>

      {/* Screen-reader text twin — the same system as a plain nested outline */}
      <ul className="sr-only" aria-label="System overview">
        {data.features.map((f) => (
          <li key={f.slug}>
            {f.title}: {f.capabilities.length === 0 ? "no actions" : f.capabilities.map((c) => `${c.actor} can ${c.action}`).join("; ")}
            {f.dataLabels.length > 0 ? `. Stores ${f.dataLabels.join(", ")}` : ""}
            {f.external && f.external.length > 0 ? `. Uses ${f.external.join(", ")}` : ""}
          </li>
        ))}
      </ul>

      {!present && (
        <>
          <div className="absolute right-3 top-3 z-10">
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Find a part…"
              className="h-7 w-[150px] rounded-lg border border-[hsl(var(--border))] bg-[color:var(--paper)] px-2.5 text-[12px] text-[color:var(--ink)] outline-none placeholder:text-[color:var(--ink-faint)] focus:border-[color:var(--accent)]"
            />
          </div>
          <Legend />
          {findings.length > 0 && <Findings items={findings} />}
          <Controls onIn={() => zoomBy(1.25)} onOut={() => zoomBy(0.8)} onFit={fit} />
        </>
      )}

      <Actions onExport={exportSvg} present={present} onPresent={() => setPresent((p) => !p)} />
    </div>
  );
}

function EdgeLine({ e }: { e: PEdge }) {
  // cross-cluster relationships are the most decision-relevant ink → promote; inner flow → recede.
  const dash = e.cross ? (e.mutual ? "5 4" : e.label === "Notifies" ? "1.5 4" : undefined) : undefined;
  return (
    <polyline
      points={e.pts.map((p) => `${p.x},${p.y}`).join(" ")}
      fill="none"
      stroke={e.cross ? "var(--ink-soft)" : "var(--ink-faint)"}
      strokeWidth={e.cross ? 1.5 : 1.3}
      strokeDasharray={dash}
      strokeLinejoin="round"
      markerEnd={e.cross ? "url(#hm-arrow)" : "url(#hm-arrow-faint)"}
      opacity={e.cross ? 0.95 : 0.6}
    />
  );
}

function NodeShape({ n }: { n: PNode }) {
  const { x, y, w, h, kind } = n;
  const cx = x + w / 2, cy = y + h / 2;
  const lines = wrapLabel(n.label, kind === "decision" ? 15 : 18);
  const stroke = kind === "external" ? "var(--ink-faint)" : "hsl(var(--border))";
  const fill = kind === "decision" ? "var(--accent-wash)" : "var(--paper-raised)";

  let shape: React.ReactNode;
  if (kind === "decision") {
    shape = <polygon points={`${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`} fill={fill} stroke="color-mix(in srgb, var(--accent) 48%, transparent)" strokeWidth={1.3} />;
  } else if (kind === "state") {
    // lifecycle phase = stadium (fully rounded)
    shape = <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="var(--paper)" stroke="var(--ink-soft)" strokeWidth={1.3} />;
  } else if (kind === "external") {
    // outside service = dashed border (foreign by construction)
    shape = <rect x={x} y={y} width={w} height={h} rx={9} fill="var(--paper)" stroke={stroke} strokeWidth={1.3} strokeDasharray="5 3" />;
  } else if (kind === "data") {
    // a thing the system stores = double top line (data-store convention)
    shape = (
      <g>
        <rect x={x} y={y} width={w} height={h} rx={7} fill="var(--paper-sunken)" stroke={stroke} strokeWidth={1.2} />
        <line x1={x + 6} y1={y + 5} x2={x + w - 6} y2={y + 5} stroke={stroke} strokeWidth={1} opacity={0.7} />
      </g>
    );
  } else {
    // operation (a thing you can do) = rect + left rule; rule color = changes data (accent) vs only views (soft)
    shape = (
      <g>
        <rect x={x} y={y} width={w} height={h} rx={9} fill={fill} stroke={stroke} strokeWidth={1.2} />
        <rect x={x} y={y + 6} width={2.5} height={h - 12} rx={1.25} fill={n.access === "writes" ? "var(--accent)" : "var(--ink-soft)"} />
      </g>
    );
  }

  const fontSize = kind === "decision" ? 11 : 12;
  const lineH = 14;
  const startY = cy - ((lines.length - 1) * lineH) / 2 + 4;
  return (
    <g>
      {shape}
      <text x={cx} y={startY} textAnchor="middle" fontSize={fontSize} fill="var(--ink)" style={{ fontFamily: "var(--font-sans, sans-serif)" }}>
        {lines.map((l, i) => <tspan key={i} x={cx} dy={i === 0 ? 0 : lineH}>{l}</tspan>)}
      </text>
    </g>
  );
}

const LEGEND_KEY = "solarch:simple-legend";
function Legend() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(LEGEND_KEY) !== "0"; } catch { return true; }
  });
  const toggle = () => { const n = !open; setOpen(n); try { localStorage.setItem(LEGEND_KEY, n ? "1" : "0"); } catch { /* noop */ } };
  return (
    <div className="absolute left-3 top-3 max-w-[240px] select-none rounded-lg border border-[hsl(var(--border))] bg-[color:var(--paper)] text-[11.5px]">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 font-medium text-[color:var(--ink-soft)] outline-none transition-colors hover:text-[color:var(--ink)]">
        How to read this
        <span className="text-[color:var(--ink-faint)]">{open ? "–" : "+"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-[hsl(var(--border))] px-3 py-2 text-[color:var(--ink-soft)]">
          <Key glyph="diamond">a sign-in check</Key>
          <Key glyph="op">something you can do</Key>
          <Key glyph="state">a lifecycle phase</Key>
          <Key glyph="data">data it stores</Key>
          <Key glyph="ext">an outside service</Key>
          <div className="mt-1 border-t border-[hsl(var(--border))] pt-1.5">
            <Key glyph="solid">needs</Key>
            <Key glyph="dash">works together</Key>
            <Key glyph="dot">notifies</Key>
          </div>
        </div>
      )}
    </div>
  );
}

function Key({ glyph, children }: { glyph: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="26" height="14" className="shrink-0">
        {glyph === "diamond" && <polygon points="13,1 24,7 13,13 2,7" fill="var(--accent-wash)" stroke="color-mix(in srgb, var(--accent) 48%, transparent)" strokeWidth="1" />}
        {glyph === "op" && <><rect x="3" y="3" width="20" height="8" rx="2" fill="var(--paper-raised)" stroke="hsl(var(--border))" /><rect x="3" y="4" width="1.6" height="6" fill="var(--ink-soft)" /></>}
        {glyph === "state" && <rect x="2" y="3" width="22" height="8" rx="4" fill="var(--paper)" stroke="var(--ink-soft)" />}
        {glyph === "data" && <><rect x="3" y="3" width="20" height="8" rx="2" fill="var(--paper-sunken)" stroke="hsl(var(--border))" /><line x1="5" y1="4.5" x2="21" y2="4.5" stroke="hsl(var(--border))" /></>}
        {glyph === "ext" && <rect x="3" y="3" width="20" height="8" rx="2" fill="var(--paper)" stroke="var(--ink-faint)" strokeDasharray="3 2" />}
        {glyph === "solid" && <line x1="2" y1="7" x2="24" y2="7" stroke="var(--ink-soft)" strokeWidth="1.4" />}
        {glyph === "dash" && <line x1="2" y1="7" x2="24" y2="7" stroke="var(--ink-soft)" strokeWidth="1.4" strokeDasharray="5 4" />}
        {glyph === "dot" && <line x1="2" y1="7" x2="24" y2="7" stroke="var(--ink-soft)" strokeWidth="1.4" strokeDasharray="1.5 4" />}
      </svg>
      {children}
    </span>
  );
}

function Controls({ onIn, onOut, onFit }: { onIn: () => void; onOut: () => void; onFit: () => void }) {
  const btn = "flex h-7 w-7 items-center justify-center text-[color:var(--ink-soft)] outline-none transition-colors hover:text-[color:var(--ink)]";
  return (
    <div className="absolute bottom-3 right-3 flex items-center rounded-lg border border-[hsl(var(--border))] bg-[color:var(--paper)]">
      <button type="button" onClick={onOut} title="Zoom out" className={btn}>
        <svg width="14" height="14" viewBox="0 0 14 14"><line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      <button type="button" onClick={onFit} title="Fit (F)" className={`${btn} border-x border-[hsl(var(--border))]`}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9" strokeLinecap="round" /></svg>
      </button>
      <button type="button" onClick={onIn} title="Zoom in" className={btn}>
        <svg width="14" height="14" viewBox="0 0 14 14"><line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.4" /><line x1="7" y1="3" x2="7" y2="11" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
    </div>
  );
}

function Findings({ items }: { items: string[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="absolute bottom-12 left-3 z-10 max-w-[280px] select-none rounded-lg border border-[hsl(var(--border))] bg-[color:var(--paper)] text-[11.5px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 font-medium text-[color:var(--ink-soft)] outline-none transition-colors hover:text-[color:var(--ink)]">
        Worth a look <span className="text-[color:var(--ink-faint)]">{items.length}</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-1 border-t border-[hsl(var(--border))] px-3 py-2 text-[color:var(--ink-soft)]">
          {items.map((it, i) => <li key={i} className="flex gap-1.5 leading-snug"><span className="text-[color:var(--accent)]">·</span>{it}</li>)}
        </ul>
      )}
    </div>
  );
}

function Actions({ onExport, present, onPresent }: { onExport: () => void; present: boolean; onPresent: () => void }) {
  const btn = "flex h-7 w-7 items-center justify-center text-[color:var(--ink-soft)] outline-none transition-colors hover:text-[color:var(--ink)]";
  return (
    <div className="absolute bottom-3 left-3 z-10 flex items-center rounded-lg border border-[hsl(var(--border))] bg-[color:var(--paper)]">
      <button type="button" onClick={onExport} title="Download as SVG" className={btn}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M7 2v7M4 6.5 7 9.5l3-3M2.5 11.5h9" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button type="button" onClick={onPresent} title={present ? "Exit present (Esc)" : "Present"} className={`${btn} border-l border-[hsl(var(--border))]`}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 5V2.5A.5.5 0 0 1 2.5 2H5M9 2h2.5a.5.5 0 0 1 .5.5V5M12 9v2.5a.5.5 0 0 1-.5.5H9M5 12H2.5a.5.5 0 0 1-.5-.5V9" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[color:var(--paper)] px-6 text-center">
      <p className="font-mono text-[13px] text-[color:var(--ink-faint)] animate-in fade-in duration-200">{children}</p>
    </div>
  );
}
