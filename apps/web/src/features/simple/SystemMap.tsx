/** Level A — System Map: feature boxes + "uses/triggers" arrows.
 *
 *  Phase 3: dagre layout (left-to-right, layered) — base features on the left, crossings
 *  minimized (no "graph soup" in multi-feature projects; research recommendation). Path-highlight:
 *  hover a box → connected arrows+neighbors light up, the rest fade (proven
 *  path-tracing technique). Click a box → that feature's capability list (Level B).
 *  Calm: single accent, soft shadow, no gradient/glassmorphism. */

import { useMemo, useState } from "react";
import dagre from "@dagrejs/dagre";
import { ChevronRight, Cloud } from "lucide-react";
import type { SystemMap as SystemMapData, FeatureBox } from "./types";

interface Rect { x: number; y: number; w: number; h: number }

/** Box size (based on content line count) — passed to dagre. */
function boxSize(f: FeatureBox): { w: number; h: number } {
  let h = 58; // title + "N capabilities"
  if (f.dataLabels.length > 0) h += 19;
  if (f.external && f.external.length > 0) h += 19;
  return { w: 212, h };
}

export function SystemMap({ data, onSelect }: { data: SystemMapData; onSelect: (slug: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 26, ranksep: 104, marginx: 24, marginy: 24 });
    g.setDefaultEdgeLabel(() => ({}));
    const known = new Set(data.features.map((f) => f.slug));
    for (const f of data.features) {
      const s = boxSize(f);
      g.setNode(f.slug, { width: s.w, height: s.h });
    }
    // Layout PRIORITY (base on left): for "uses" A->B, B is base → dagre B->A;
    //   for "triggers" A->B, A is upstream → dagre A->B. Both place the base on the left.
    for (const a of data.arrows) {
      if (!known.has(a.from) || !known.has(a.to)) continue;
      if (a.label === "triggers") g.setEdge(a.from, a.to);
      else g.setEdge(a.to, a.from);
    }
    dagre.layout(g);

    const rects: Record<string, Rect> = {};
    for (const f of data.features) {
      const p = g.node(f.slug);
      if (p) rects[f.slug] = { x: p.x, y: p.y, w: p.width, h: p.height };
    }
    const dim = g.graph();
    return { rects, width: dim.width ?? 0, height: dim.height ?? 0 };
  }, [data]);

  // Neighborhood (path-highlight): hovered + directly connected features are active.
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const f of data.features) m.set(f.slug, new Set([f.slug]));
    for (const a of data.arrows) {
      m.get(a.from)?.add(a.to);
      m.get(a.to)?.add(a.from);
    }
    return m;
  }, [data]);

  const boxActive = (slug: string) => hover === null || neighbors.get(hover)?.has(slug) === true;

  const { rects, width, height } = layout;

  return (
    <div className="relative" style={{ width, height }}>
      {/* Arrows (behind the boxes). */}
      <ArrowLayer data={data} rects={rects} hover={hover} />

      {data.features.map((f) => {
        const r = rects[f.slug];
        if (!r) return null;
        const active = boxActive(f.slug);
        return (
          <button
            key={f.slug}
            type="button"
            onMouseEnter={() => setHover(f.slug)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(f.slug)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect(f.slug)}
            className="group absolute z-[1] rounded-xl border border-[hsl(var(--border))] bg-[color:var(--paper-raised)] px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.06)] outline-none transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--accent)]/55 hover:shadow-[0_4px_16px_rgba(0,0,0,0.10)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/55"
            style={{ left: r.x - r.w / 2, top: r.y - r.h / 2, width: r.w, height: r.h, opacity: active ? 1 : 0.32 }}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[15px] font-semibold tracking-[-0.01em] text-[color:var(--ink)]">{f.title}</span>
              <ChevronRight size={16} className="mt-0.5 shrink-0 text-[color:var(--ink-faint)] transition-colors group-hover:text-[color:var(--accent)]" />
            </div>
            <div className="mt-1.5 text-[12.5px] text-[color:var(--ink-soft)]">{f.capabilityCount} capabilities</div>
            {f.dataLabels.length > 0 && (
              <div className="mt-1 truncate text-[12.5px] text-[color:var(--ink-soft)]">{f.dataLabels.join(" · ")}</div>
            )}
            {f.external && f.external.length > 0 && (
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[color:var(--ink-soft)]">
                <Cloud size={12.5} className="text-[color:var(--ink-faint)]" />
                External: {f.external.join(", ")}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** SVG arrow layer (soft bezier; calmer than orthogonal for the macro relationship graph) +
 *  HTML label chips. dagre draws from the box edges; responsive to path-highlight. */
function ArrowLayer({
  data,
  rects,
  hover,
}: {
  data: SystemMapData;
  rects: Record<string, Rect>;
  hover: string | null;
}) {
  // no hover: neutral. on hover: touching arrows are HIGHLIGHTED (accent), the rest faded.
  const stateOf = (a: { from: string; to: string }): "neutral" | "on" | "dim" => {
    if (hover === null) return "neutral";
    return a.from === hover || a.to === hover ? "on" : "dim";
  };
  const drawable = data.arrows.filter((a) => rects[a.from] && rects[a.to]);
  if (drawable.length === 0) return null;

  const paths = drawable.map((a) => {
    const s = rects[a.from]!;
    const t = rects[a.to]!;
    const leftward = t.x + t.w / 2 < s.x + s.w / 2;
    const start = { x: leftward ? s.x - s.w / 2 : s.x + s.w / 2, y: s.y };
    const end = { x: leftward ? t.x + t.w / 2 : t.x - t.w / 2, y: t.y };
    const dx = (end.x - start.x) * 0.45;
    const d = `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;
    return { a, d, mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
  });

  return (
    <>
      <svg className="absolute inset-0 z-0 h-full w-full overflow-visible">
        <defs>
          <marker id="sm-arrow" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="var(--ink-faint)" />
          </marker>
          <marker id="sm-arrow-on" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="var(--accent)" />
          </marker>
        </defs>
        {paths.map(({ a, d }, i) => {
          const st = stateOf(a);
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={st === "on" ? "var(--accent)" : "var(--ink-faint)"}
              strokeWidth={st === "on" ? 1.9 : 1.5}
              strokeDasharray={a.mutual ? "5 4" : undefined}
              markerEnd={st === "on" ? "url(#sm-arrow-on)" : "url(#sm-arrow)"}
              className="transition-[opacity,stroke,stroke-width] duration-200"
              opacity={st === "dim" ? 0.18 : 0.85}
            />
          );
        })}
      </svg>
      {paths.map(({ a, mid }, i) => {
        const st = stateOf(a);
        return (
          <span
            key={i}
            className="pointer-events-none absolute z-[1] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[color:var(--paper)] px-1.5 py-0.5 font-mono text-[11px] transition-opacity duration-200"
            style={{ left: mid.x, top: mid.y, opacity: st === "dim" ? 0.25 : 1, color: st === "on" ? "var(--accent-ink)" : "var(--ink-soft)" }}
          >
            {a.mutual ? `${a.label} ⇄` : a.label}
          </span>
        );
      })}
    </>
  );
}
