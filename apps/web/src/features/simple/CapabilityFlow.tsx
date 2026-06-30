/** Capability LOGIC DIAGRAM (flowchart) — draws a capability's flow with the
 *  classic flowchart vocabulary: terminal (start/end), process (step), DECISION
 *  (diamond, branches + labeled arrows), data (writes/reads), external (outside service).
 *
 *  Layout: dagre (layered, top-to-bottom) — precise/clean lines + ORTHOGONAL
 *  (right-angle) connectors. NOT SKETCHY: research showed hand-drawn aesthetics
 *  signal "draft", hurt the "verified" positioning, and distort quantitative
 *  perception. Approachability comes from a minimal vocabulary + calm palette,
 *  not scribbled lines. No emoji/gradient.
 *
 *  Phase 1: from fixture (CapabilityFlow). Phase 2: same shape derived from the graph
 *  (Controller.Endpoint → terminal/process; condition → decision; Table → data). */

import { useMemo, useState } from "react";
import dagre from "@dagrejs/dagre";
import type { CapabilityFlow as FlowData, FlowNode, FlowNodeKind } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Node size by label (passed to dagre). Wider for diamond text. */
function sizeOf(n: FlowNode): { w: number; h: number } {
  const len = n.label.length;
  switch (n.kind) {
    case "decision":
      return { w: clamp(len * 7.2 + 56, 132, 212), h: 66 };
    case "terminal":
    case "end":
      return { w: clamp(len * 7 + 36, 112, 240), h: 38 };
    case "data":
      return { w: clamp(len * 7 + 48, 104, 208), h: 40 };
    case "external":
      return { w: clamp(len * 7 + 50, 112, 220), h: 40 };
    default:
      return { w: clamp(len * 7 + 32, 96, 230), h: 42 };
  }
}

/** Shape fill/stroke style (theme tokens; light/dark automatic). */
function styleOf(kind: FlowNodeKind): { fill: string; stroke: string; dash?: string } {
  switch (kind) {
    case "decision":
      return { fill: "var(--accent-wash)", stroke: "color-mix(in srgb, var(--accent) 48%, transparent)" };
    case "data":
      return { fill: "var(--paper-sunken)", stroke: "hsl(var(--border))" };
    case "external":
      return { fill: "var(--paper-sunken)", stroke: "hsl(var(--border))", dash: "4 3" };
    case "terminal":
    case "end":
      return { fill: "var(--paper-raised)", stroke: "var(--ink-faint)" };
    default:
      return { fill: "var(--paper-raised)", stroke: "hsl(var(--border))" };
  }
}

interface Placed extends FlowNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function CapabilityFlow({ flow }: { flow: FlowData }) {
  const layout = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", nodesep: 30, ranksep: 46, marginx: 22, marginy: 18 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of flow.nodes) {
      const s = sizeOf(n);
      g.setNode(n.id, { width: s.w, height: s.h });
    }
    for (const e of flow.edges) g.setEdge(e.from, e.to);
    dagre.layout(g);

    const nodes: Placed[] = flow.nodes.map((n) => {
      const p = g.node(n.id);
      return { ...n, x: p.x, y: p.y, w: p.width, h: p.height };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = flow.edges
      .map((e) => ({ ...e, s: byId.get(e.from), t: byId.get(e.to) }))
      .filter((e): e is typeof e & { s: Placed; t: Placed } => Boolean(e.s && e.t));
    const dim = g.graph();
    return { nodes, edges, width: dim.width ?? 0, height: dim.height ?? 0 };
  }, [flow]);

  const { nodes, edges, width, height } = layout;

  // Path-highlight: hover a node → the path PASSING through it (ancestors +
  //   descendants) lights up, the rest fades. In a branching diagram, traces
  //   "how do you reach this / what happens next" (research-backed path-tracing).
  const [hoverId, setHoverId] = useState<string | null>(null);
  const adj = useMemo(() => {
    const fwd = new Map<string, string[]>();
    const bwd = new Map<string, string[]>();
    for (const n of nodes) { fwd.set(n.id, []); bwd.set(n.id, []); }
    for (const e of edges) { fwd.get(e.from)?.push(e.to); bwd.get(e.to)?.push(e.from); }
    return { fwd, bwd };
  }, [nodes, edges]);
  const reachable = useMemo(() => {
    if (!hoverId) return null;
    const seen = new Set<string>([hoverId]);
    const walk = (m: Map<string, string[]>) => {
      const q = [hoverId];
      while (q.length) {
        const c = q.shift()!;
        for (const nx of m.get(c) ?? []) if (!seen.has(nx)) { seen.add(nx); q.push(nx); }
      }
    };
    walk(adj.fwd);
    walk(adj.bwd);
    return seen;
  }, [hoverId, adj]);
  const nodeOn = (id: string) => !reachable || reachable.has(id);
  const edgeOn = (from: string, to: string) => !reachable || (reachable.has(from) && reachable.has(to));

  return (
    <div className="relative mx-auto" style={{ width, height }}>
      <svg className="absolute inset-0 overflow-visible" width={width} height={height}>
        <defs>
          <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="6.4" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="var(--ink-faint)" />
          </marker>
          <marker id="flow-arrow-on" markerWidth="8" markerHeight="8" refX="6.4" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="var(--accent)" />
          </marker>
        </defs>

        {/* Orthogonal edges (source bottom → target top; right-angle bends). */}
        {edges.map((e, i) => {
          const sx = e.s.x;
          const sB = e.s.y + e.s.h / 2;
          const tx = e.t.x;
          const tT = e.t.y - e.t.h / 2;
          const straight = Math.abs(sx - tx) < 1.5;
          const midY = (sB + tT) / 2;
          const d = straight
            ? `M ${sx} ${sB} L ${tx} ${tT}`
            : `M ${sx} ${sB} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${tT}`;
          const on = edgeOn(e.from, e.to);
          const hot = !!reachable && on;
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={hot ? "var(--accent)" : "var(--ink-faint)"}
              strokeWidth={hot ? 1.8 : 1.4}
              markerEnd={hot ? "url(#flow-arrow-on)" : "url(#flow-arrow)"}
              className="transition-[opacity,stroke,stroke-width] duration-200"
              opacity={on ? 0.9 : 0.12}
            />
          );
        })}

        {/* Shapes (flowchart vocabulary). */}
        {nodes.map((n) => {
          const st = styleOf(n.kind);
          const { x, y, w, h } = n;
          const common = {
            fill: st.fill,
            stroke: st.stroke,
            strokeWidth: 1.4,
            strokeDasharray: st.dash,
            opacity: nodeOn(n.id) ? 1 : 0.22,
            className: "transition-opacity duration-200",
          };
          if (n.kind === "decision") {
            const pts = `${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}`;
            return <polygon key={n.id} points={pts} {...common} />;
          }
          if (n.kind === "data") {
            const k = 12;
            const pts = `${x - w / 2 + k},${y - h / 2} ${x + w / 2},${y - h / 2} ${x + w / 2 - k},${y + h / 2} ${x - w / 2},${y + h / 2}`;
            return <polygon key={n.id} points={pts} {...common} />;
          }
          const rx = n.kind === "terminal" || n.kind === "end" ? h / 2 : 9;
          return <rect key={n.id} x={x - w / 2} y={y - h / 2} width={w} height={h} rx={rx} {...common} />;
        })}
      </svg>

      {/* Node labels (HTML — crisp typography + theme). Hover target = path-tracing. */}
      {nodes.map((n) => (
        <div
          key={n.id}
          onMouseEnter={() => setHoverId(n.id)}
          onMouseLeave={() => setHoverId(null)}
          className="absolute flex items-center justify-center gap-1.5 text-center font-sans leading-tight transition-opacity duration-200"
          style={{
            left: n.x - n.w / 2,
            top: n.y - n.h / 2,
            width: n.w,
            height: n.h,
            padding: "0 8px",
            opacity: nodeOn(n.id) ? 1 : 0.3,
            fontSize: n.kind === "decision" ? 11.5 : 12.5,
            color:
              n.kind === "terminal" || n.kind === "end" || n.kind === "external"
                ? "var(--ink-soft)"
                : "var(--ink)",
          }}
        >
          {n.kind === "data" && n.access && (
            <span
              aria-hidden
              className="inline-block h-[8px] w-[8px] shrink-0 rounded-[2px]"
              style={
                n.access === "writes"
                  ? { background: "var(--accent)" }
                  : { border: "1px solid var(--ink-faint)" }
              }
            />
          )}
          <span className="truncate">
            {n.kind === "external" ? `External: ${n.label}` : n.label}
          </span>
        </div>
      ))}

      {/* Branch labels (Yes/No) — at the middle of the decision arrows' horizontal segment. */}
      {edges.map((e, i) => {
        if (!e.label) return null;
        const sx = e.s.x;
        const sB = e.s.y + e.s.h / 2;
        const tx = e.t.x;
        const tT = e.t.y - e.t.h / 2;
        const straight = Math.abs(sx - tx) < 1.5;
        const lx = straight ? sx + 12 : (sx + tx) / 2;
        const ly = straight ? (sB + tT) / 2 : (sB + tT) / 2 - 9;
        return (
          <span
            key={`l${i}`}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-[color:var(--paper)] px-1 font-mono text-[10.5px] transition-opacity duration-200"
            style={{ left: lx, top: ly, opacity: edgeOn(e.from, e.to) ? 1 : 0.25, color: reachable && edgeOn(e.from, e.to) ? "var(--accent-ink)" : "var(--ink-soft)" }}
          >
            {e.label}
          </span>
        );
      })}
    </div>
  );
}
