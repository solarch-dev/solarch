/** Sketch Simple View — the whole system as a hand-drawn (Excalidraw-style) diagram.
 *
 *  Pipeline: SystemMap → Mermaid text → @excalidraw/mermaid-to-excalidraw (parses +
 *  lays out via Mermaid's own engine → skeleton elements with x/y) → our own rough.js
 *  SVG render (hand-drawn strokes; seed derived from element id = DETERMINISTIC sketch).
 *
 *  It is an EDITABLE PRESENTATION LAYER: nodes can be dragged, labels renamed, and the
 *  whole surface is keyboard-operable + screen-reader friendly. None of this touches the
 *  technical graph — overrides live only here (drag positions + label text), so the
 *  Simple View stays a faithful, drift-free projection of the source. */

import rough from "roughjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SystemMap } from "./types";
import type { SimpleSketchModel } from "../../api/codegen";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const STROKE_MS = 420, TEXT_MS = 340; // per-element outline-draw / text-type durations
const DRAW_TOTAL = STROKE_MS + TEXT_MS + 200; // a fully-drawn element after this much local time

/** Stable FNV-1a hash → rough.js seed (same element id → identical hand-drawn strokes). */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % 2147483647;
}

const sanId = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "_");
const esc = (s: string) => s.replace(/["\n]/g, "'");

/** Node-kind → Mermaid shape (mirrors the backend): decision={}, state=([]),
 *  data=[()] (cylinder), external=[//] (parallelogram), step=[]. */
function flowShape(kind: string, id: string, label: string): string {
  const l = `"${esc(label)}"`;
  switch (kind) {
    case "decision": return `${id}{${l}}`;
    case "state": return `${id}([${l}])`;
    case "data": return `${id}[(${l})]`;
    case "external": return `${id}[/${l}/]`;
    default: return `${id}[${l}]`;
  }
}

/** Deterministic SystemMap → rich Mermaid flowchart. Mirrors the backend baseline
 *  (feature → data-flow cluster: ops + a data store with labeled Saves/Reads flows +
 *  outside services it "Uses"). This is only the emergency client fallback used when the
 *  server sketch is unavailable; the primary source is the server's (AI) Mermaid. */
function dataToMermaid(data: SystemMap): string {
  const lines = ["flowchart TD"];
  for (const f of data.features) {
    const fid = sanId(f.slug);
    lines.push(`  ${fid}["${esc(f.title)}"]`);
    const fg = f.flowGraph;
    if (fg && fg.nodes.length > 0) {
      for (const n of fg.nodes) lines.push(`  ${flowShape(n.kind, `${fid}__${sanId(n.id)}`, n.label)}`);
      for (const e of fg.edges) {
        const lbl = e.label ? `|${esc(e.label)}|` : "";
        lines.push(`  ${fid}__${sanId(e.from)} -->${lbl} ${fid}__${sanId(e.to)}`);
      }
      const hasIncoming = new Set(fg.edges.map((e) => e.to));
      const entries = fg.nodes.filter((n) => !hasIncoming.has(n.id));
      for (const n of (entries.length ? entries : fg.nodes.slice(0, 1))) {
        const lbl = n.kind === "external" ? "|Uses|" : "";
        lines.push(`  ${fid} -->${lbl} ${fid}__${sanId(n.id)}`);
      }
    } else {
      lines.push(`  ${fid}__x["${f.capabilityCount} things you can do"]`);
      lines.push(`  ${fid} --> ${fid}__x`);
    }
  }
  for (const a of data.arrows) {
    const lbl = a.label ? `|${esc(a.label)}|` : "";
    lines.push(`  ${sanId(a.from)} -->${lbl} ${sanId(a.to)}`);
  }
  return lines.join("\n");
}

interface Skel {
  id?: string;
  type: string;
  x: number; y: number;
  width?: number; height?: number;
  points?: [number, number][];
  label?: { text?: string } | string;
  strokeStyle?: string;
  start?: { id?: string };
  end?: { id?: string };
  color?: string;
  group?: string;
}
interface SketchGroupMeta { id: string; name: string; color?: string }
interface SketchScene { elements: Skel[]; minX: number; minY: number; w: number; h: number; stagger: number; groups?: SketchGroupMeta[] }

/** Order elements so the sketch "draws itself" along the flow: each box appears, then
 *  the arrow leaving it, then the box it points to (BFS from the roots). Arrows are
 *  interleaved right after BOTH endpoints exist — never drawn into empty space. Anything
 *  unreachable falls back to top-to-bottom. Convention-agnostic (uses arrow start/end
 *  ids), so it works for AI-authored Mermaid too. */
function flowOrder(els: Skel[]): Skel[] {
  const isArrow = (e: Skel) => e.type === "arrow" || e.type === "line";
  const shapes = els.filter((e) => !isArrow(e));
  const arrows = els.filter(isArrow);
  const byId = new Map<string, Skel>();
  for (const s of shapes) if (s.id) byId.set(s.id, s);
  const sortYX = (a: Skel, b: Skel) => a.y - b.y || a.x - b.x;

  const out = new Map<string, { edge: Skel; to: string }[]>();
  const indeg = new Map<string, number>();
  for (const s of shapes) if (s.id) indeg.set(s.id, 0);
  for (const a of arrows) {
    const from = a.start?.id, to = a.end?.id;
    if (from && to && byId.has(from) && byId.has(to)) {
      (out.get(from) ?? out.set(from, []).get(from)!).push({ edge: a, to });
      indeg.set(to, (indeg.get(to) ?? 0) + 1);
    }
  }

  const order: Skel[] = [];
  const emitted = new Set<string>();
  const queue: string[] = [];
  const seed = (id: string) => { if (byId.has(id) && !emitted.has(id)) { emitted.add(id); order.push(byId.get(id)!); queue.push(id); } };
  for (const s of [...shapes].sort(sortYX)) if (s.id && (indeg.get(s.id) ?? 0) === 0) seed(s.id);
  if (queue.length === 0) { const top = [...shapes].sort(sortYX)[0]; if (top?.id) seed(top.id); }
  for (let head = 0; head < queue.length; head++) {
    const outs = (out.get(queue[head]) ?? []).sort((p, q) => sortYX(byId.get(p.to)!, byId.get(q.to)!));
    for (const { edge, to } of outs) { seed(to); order.push(edge); }
  }
  for (const s of [...shapes].sort(sortYX)) if (s.id && !emitted.has(s.id)) { emitted.add(s.id); order.push(s); }
  const placed = new Set(order);
  for (const a of arrows) if (!placed.has(a)) order.push(a);
  return order;
}

function labelText(el: Skel): string {
  if (!el.label) return "";
  return typeof el.label === "string" ? el.label : el.label.text ?? "";
}

/** Lay a structured SimpleSketchModel out with ELK (DOWN / layered) and convert to the SAME
 *  Skel[] the renderer already consumes — so drag, elbow-routing, edge handles, rename, the
 *  draw-in animation and a11y all keep working. Mermaid-free: no parse round-trip, no SubGraph
 *  error class. Edges carry start/end ids → our own obstacle-avoiding router draws them. */
type ElkChild = { id: string; x?: number; y?: number; width?: number; height?: number; children?: ElkChild[] };
type ElkRes = { children?: ElkChild[]; width?: number; height?: number };
async function modelToElements(model: SimpleSketchModel): Promise<{ els: Skel[]; groups: SketchGroupMeta[] }> {
  const ELK = (await import("elkjs/lib/elk.bundled.js")).default as new () => { layout: (g: unknown) => Promise<ElkRes> };
  const elk = new ELK();
  // FIXED size per kind (independent of the live name) → the baseline and the AI-enriched model
  // produce the IDENTICAL ELK layout, so names/colors settle in WITHOUT the boxes jumping.
  const sizeOf = (n: { kind: string }) => {
    switch (n.kind) {
      case "feature": return { w: 158, h: 46 };
      case "data": return { w: 132, h: 46 };
      case "external": return { w: 134, h: 42 };
      case "decision": return { w: 140, h: 56 };
      case "state": return { w: 124, h: 42 };
      default: return { w: 130, h: 40 };
    }
  };
  const sizes = new Map(model.nodes.map((n) => [n.id, sizeOf(n)] as const));
  const nodeIds = new Set(model.nodes.map((n) => n.id));
  const groupIds = new Set(model.groups.map((g) => g.id));
  // An edge endpoint is either a node id (intra-feature flow) or a GROUP id (cross-feature dependency).
  const validEdges = model.edges.filter(
    (e) => (nodeIds.has(e.from) || groupIds.has(e.from)) && (nodeIds.has(e.to) || groupIds.has(e.to)),
  );
  const intraEdges = validEdges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  const crossEdges = validEdges.filter((e) => groupIds.has(e.from) || groupIds.has(e.to));
  const byGroup = new Map<string, typeof model.nodes>();
  for (const n of model.nodes) { const g = n.group ?? "__"; (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(n); }

  // Mermaid-like CLEAN, SEQUENTIAL, VERTICAL flow (Sugiyama): network-simplex layering + Brandes-Köpf
  // x-placement with an EXPLICIT BALANCED alignment (default NONE doesn't straighten) → linear chains
  // become single columns. Model order keeps it deterministic. Used for BOTH passes below.
  const COMMON = {
    "elk.algorithm": "layered", "elk.direction": "DOWN",
    "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.spacing.nodeNode": "44",
    "elk.layered.spacing.nodeNodeBetweenLayers": "70",
    "elk.spacing.componentComponent": "64",
  };

  // PASS 1 — lay out each group's INTERNAL flow on its own: a FLAT layered graph (no hierarchy), so
  // ELK never hits the compound + cross-edge-cycle crash. Gives group-local node positions + bbox.
  const localPos = new Map<string, { x: number; y: number }>();
  const groupContent = new Map<string, { minX: number; minY: number; w: number; h: number }>();
  for (const [gid, gnodes] of byGroup) {
    const ids = new Set(gnodes.map((n) => n.id));
    const ges = intraEdges.filter((e) => ids.has(e.from) && ids.has(e.to));
    const res = await elk.layout({
      id: gid, layoutOptions: COMMON,
      children: gnodes.map((n) => ({ id: n.id, width: sizes.get(n.id)!.w, height: sizes.get(n.id)!.h })),
      edges: ges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of res.children ?? []) {
      localPos.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
      minX = Math.min(minX, c.x ?? 0); minY = Math.min(minY, c.y ?? 0);
      maxX = Math.max(maxX, (c.x ?? 0) + (c.width ?? 0)); maxY = Math.max(maxY, (c.y ?? 0) + (c.height ?? 0));
    }
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
    groupContent.set(gid, { minX, minY, w: maxX - minX, h: maxY - minY });
  }

  // PASS 2 — lay out the GROUPS as PLAIN nodes (size = the region box) connected by the cross-group
  // edges. Plain nodes (not compound containers) → cycles among groups are fine, ELK never crashes →
  // the groups themselves flow + align vertically, and arrows leave each group at its boundary.
  const INSET_X = 16, INSET_TOP = 38, INSET_BOTTOM = 16; // must match the frontend region pad(16)+topPad(22)
  const res2 = await elk.layout({
    id: "top",
    layoutOptions: { ...COMMON, "elk.spacing.nodeNode": "64", "elk.layered.spacing.nodeNodeBetweenLayers": "84" },
    children: [...byGroup.keys()].map((gid) => { const gc = groupContent.get(gid)!; return { id: gid, width: gc.w + INSET_X * 2, height: gc.h + INSET_TOP + INSET_BOTTOM }; }),
    edges: crossEdges.map((e, i) => ({ id: `c${i}`, sources: [e.from], targets: [e.to] })),
  });
  const groupPos = new Map<string, { x: number; y: number }>();
  for (const c of res2.children ?? []) groupPos.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });

  // COMBINE — node absolute = group position + region inset + (node local − group content origin).
  // With these insets the frontend's region bbox lands EXACTLY on the pass-2 group box, so regions
  // never overlap and the cross-group arrows meet the group boundaries.
  const shapeFor = (kind: string) => (kind === "decision" ? "diamond" : kind === "state" ? "ellipse" : kind === "data" ? "cylinder" : kind === "external" ? "parallelogram" : "rectangle");
  // A node with no explicit color inherits its GROUP's color, so each group reads as one coherent
  // colored zone (region tint + its boxes in the same hue) and groups separate cleanly by color.
  const groupColor = new Map(model.groups.map((g) => [g.id, g.color] as const));
  const nodeEls: Skel[] = model.nodes.map((n) => {
    const gid = n.group ?? "__";
    const gp = groupPos.get(gid) ?? { x: 0, y: 0 };
    const gc = groupContent.get(gid) ?? { minX: 0, minY: 0, w: 0, h: 0 };
    const lp = localPos.get(n.id) ?? { x: 0, y: 0 };
    const s = sizes.get(n.id)!;
    const color = n.color ?? (n.group ? groupColor.get(n.group) : undefined);
    return { id: n.id, type: shapeFor(n.kind), x: gp.x + INSET_X + (lp.x - gc.minX), y: gp.y + INSET_TOP + (lp.y - gc.minY), width: s.w, height: s.h, label: n.name, color, group: n.group };
  });
  // Edge endpoints stay BARE (node id OR group id) — the renderer resolves group ids to region boxes.
  const edgeEls: Skel[] = validEdges.map((e, i) => ({ id: `e${i}`, type: "arrow", x: 0, y: 0, points: [[0, 0], [0, 0]], label: e.label ?? "", start: { id: e.from }, end: { id: e.to } }));
  return { els: [...nodeEls, ...edgeEls], groups: model.groups };
}

/** Plain-language kind for the accessible name of a shape (a person, not a developer). */
function kindWord(type: string): string {
  if (type === "diamond") return "Decision";
  if (type === "ellipse") return "State";
  return "Part";
}

type Box = { x: number; y: number; w: number; h: number };

type Side = "top" | "bottom" | "left" | "right";
const isVert = (s: Side) => s === "top" || s === "bottom";

/** The CENTRED midpoint of one of a box's four sides — the only place an arrow may connect. */
function portOf(b: Box, side: Side): [number, number] {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return side === "top" ? [cx, b.y] : side === "bottom" ? [cx, b.y + b.h] : side === "left" ? [b.x, cy] : [b.x + b.w, cy];
}
/** A point one gap OUTSIDE a port, perpendicular to its side — forces a perpendicular approach. */
function stubOf(p: [number, number], side: Side, g: number): [number, number] {
  return side === "top" ? [p[0], p[1] - g] : side === "bottom" ? [p[0], p[1] + g] : side === "left" ? [p[0] - g, p[1]] : [p[0] + g, p[1]];
}
/** Pick which side of each box the connector uses, from the dominant centre-to-centre direction:
 *  target below → leave the source BOTTOM, enter the target TOP; to the right → right→left; up →
 *  top→bottom; etc. So the arrow always meets the MIDDLE of the side that faces the other box. */
function chooseSides(s: Box, t: Box): { sSide: Side; tSide: Side } {
  const dx = (t.x + t.w / 2) - (s.x + s.w / 2), dy = (t.y + t.h / 2) - (s.y + s.h / 2);
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? { sSide: "bottom", tSide: "top" } : { sSide: "top", tSide: "bottom" };
  return dx >= 0 ? { sSide: "right", tSide: "left" } : { sSide: "left", tSide: "right" };
}
/** Orthogonal S/L-bend between two centred ports — first segment perpendicular to the source
 *  side, last segment perpendicular to the target side (chooseSides keeps both on one axis). */
function connectPorts(a: [number, number], aSide: Side, b: [number, number], bSide: Side): [number, number][] {
  if (isVert(aSide) && isVert(bSide)) { const my = (a[1] + b[1]) / 2; return [a, [a[0], my], [b[0], my], b]; }
  if (!isVert(aSide) && !isVert(bSide)) { const mx = (a[0] + b[0]) / 2; return [a, [mx, a[1]], [mx, b[1]], b]; }
  return isVert(aSide) ? [a, [a[0], b[1]], b] : [a, [b[0], a[1]], b];
}

/** Orthogonal "elbow" — enters/leaves the CENTRED midpoint of the facing side, always
 *  perpendicular to it, biased vertical so the diagram reads top-to-bottom. */
function elbow(s: Box, t: Box): [number, number][] {
  const { sSide, tSide } = chooseSides(s, t);
  return dedupeCollinear(connectPorts(portOf(s, sSide), sSide, portOf(t, tSide), tSide));
}

type Pt = [number, number];
const ROUTE_GAP = 14; // padding kept between a routed arrow and any box it must dodge

function expandBox(b: Box, g: number): Box { return { x: b.x - g, y: b.y - g, w: b.w + 2 * g, h: b.h + 2 * g }; }
function insideBox(p: Pt, r: Box): boolean { return p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h; }

/** Axis-aligned segment vs rect, STRICT interior — a route may hug the (already gap-expanded)
 *  boundary without counting as a hit. Only axis-aligned segments are tested (orthogonal routes). */
function segHitsRect(a: Pt, b: Pt, r: Box): boolean {
  const x0 = r.x, x1 = r.x + r.w, y0 = r.y, y1 = r.y + r.h;
  if (a[1] === b[1]) { const y = a[1]; if (y <= y0 || y >= y1) return false; return Math.max(a[0], b[0]) > x0 && Math.min(a[0], b[0]) < x1; }
  if (a[0] === b[0]) { const x = a[0]; if (x <= x0 || x >= x1) return false; return Math.max(a[1], b[1]) > y0 && Math.min(a[1], b[1]) < y1; }
  return false;
}
/** Drop duplicate + collinear vertices so the polyline is minimal. */
function dedupeCollinear(pts: Pt[]): Pt[] {
  const u: Pt[] = [];
  for (const p of pts) { const l = u[u.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) u.push(p); }
  const res: Pt[] = [];
  for (let i = 0; i < u.length; i++) {
    if (i > 0 && i < u.length - 1) {
      const a = u[i - 1], b = u[i], c = u[i + 1];
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) continue;
    }
    res.push(u[i]);
  }
  return res;
}
function polylineClear(pts: Pt[], obs: Box[]): boolean {
  for (let i = 1; i < pts.length; i++) if (obs.some((r) => segHitsRect(pts[i - 1], pts[i], r))) return false;
  return true;
}

/** Pragmatic orthogonal router: build a Hanan grid from the obstacle edges + an obstacle-free
 *  outer ring, then A* (with a bend penalty) from box A's border to box B's border avoiding all
 *  the gap-expanded obstacle rects. Returns null if an endpoint is buried inside an obstacle
 *  (caller falls back to the plain elbow). */
function routeOrthogonal(s: Box, t: Box, obstacles: Box[], gap = ROUTE_GAP): Pt[] | null {
  const { sSide, tSide } = chooseSides(s, t);
  const sPort = portOf(s, sSide), tPort = portOf(t, tSide);
  // A* runs between the perpendicular STUBS (one gap outside each centred port); the ports are
  // re-attached at the very ends, so the arrow always enters/leaves perpendicular at the midpoint.
  const start = stubOf(sPort, sSide, gap), end = stubOf(tPort, tSide, gap);
  const obs = obstacles.map((b) => expandBox(b, gap));
  if (obs.some((r) => insideBox(start, r) || insideBox(end, r))) return null;
  let minX = Math.min(s.x, t.x), minY = Math.min(s.y, t.y), maxX = Math.max(s.x + s.w, t.x + t.w), maxY = Math.max(s.y + s.h, t.y + t.h);
  for (const r of obs) { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); }
  const M = gap * 2;
  const uniq = (arr: number[]) => [...new Set(arr.map((v) => Math.round(v)))].sort((a, b) => a - b);
  const xs = uniq([start[0], end[0], minX - M, maxX + M, ...obs.flatMap((r) => [r.x, r.x + r.w])]);
  const ys = uniq([start[1], end[1], minY - M, maxY + M, ...obs.flatMap((r) => [r.y, r.y + r.h])]);
  const nx = xs.length;
  const xi = xs.indexOf(Math.round(start[0])), yi = ys.indexOf(Math.round(start[1]));
  const exi = xs.indexOf(Math.round(end[0])), eyi = ys.indexOf(Math.round(end[1]));
  if (xi < 0 || yi < 0 || exi < 0 || eyi < 0) return null;
  const idx = (i: number, j: number) => j * nx + i;
  const N = nx * ys.length;
  const g = new Array<number>(N).fill(Infinity);
  const came = new Array<number>(N).fill(-1);
  const dir = new Array<number>(N).fill(0); // 1 = horizontal in, 2 = vertical in
  const start0 = idx(xi, yi), goal = idx(exi, eyi);
  g[start0] = 0;
  const open = new Set<number>([start0]);
  const BEND = gap * 1.5;
  const passable = (i0: number, j0: number, i1: number, j1: number) => !obs.some((r) => segHitsRect([xs[i0], ys[j0]], [xs[i1], ys[j1]], r));
  while (open.size) {
    let cur = -1, best = Infinity;
    for (const n of open) { const i = n % nx, j = (n / nx) | 0; const f = g[n] + Math.abs(xs[i] - xs[exi]) + Math.abs(ys[j] - ys[eyi]); if (f < best) { best = f; cur = n; } }
    if (cur === goal) break;
    open.delete(cur);
    const ci = cur % nx, cj = (cur / nx) | 0;
    const nb: Pt[] = [[ci - 1, cj], [ci + 1, cj], [ci, cj - 1], [ci, cj + 1]];
    for (const [ni, nj] of nb) {
      if (ni < 0 || ni >= nx || nj < 0 || nj >= ys.length) continue;
      if (!passable(ci, cj, ni, nj)) continue;
      const n = idx(ni, nj);
      const nd = ni !== ci ? 1 : 2;
      const seg = Math.abs(xs[ni] - xs[ci]) + Math.abs(ys[nj] - ys[cj]);
      const ng = g[cur] + seg + (dir[cur] !== 0 && dir[cur] !== nd ? BEND : 0);
      if (ng < g[n]) { g[n] = ng; came[n] = cur; dir[n] = nd; open.add(n); }
    }
  }
  if (goal !== start0 && came[goal] === -1) return null;
  const path: Pt[] = [];
  for (let n = goal; n !== -1; n = came[n]) { const i = n % nx, j = (n / nx) | 0; path.push([xs[i], ys[j]]); }
  path.reverse();
  return dedupeCollinear([sPort, ...path, tPort]);
}

/** Route bent through a user-dragged via-point (manual waypoint), kept orthogonal and still
 *  entering/leaving the centred ports perpendicularly. */
function elbowThrough(s: Box, t: Box, off: { dx: number; dy: number }): Pt[] {
  const { sSide, tSide } = chooseSides(s, t);
  const sPort = portOf(s, sSide), tPort = portOf(t, tSide);
  const sStub = stubOf(sPort, sSide, ROUTE_GAP), tStub = stubOf(tPort, tSide, ROUTE_GAP);
  const via: Pt = [(sStub[0] + tStub[0]) / 2 + off.dx, (sStub[1] + tStub[1]) / 2 + off.dy];
  const pts: Pt[] = isVert(sSide)
    ? [sPort, sStub, [sStub[0], via[1]], via, [tStub[0], via[1]], tStub, tPort]
    : [sPort, sStub, [via[0], sStub[1]], via, [via[0], tStub[1]], tStub, tPort];
  return dedupeCollinear(pts);
}

/** Single entry the render uses. Manual waypoint wins (mirrors pos-override-beats-layout); else
 *  the plain elbow if it's already clear (cheap, the common case); else A* around nearby boxes. */
function routeEdge(s: Box, t: Box, obstacles: Box[], waypoint?: { dx: number; dy: number }): Pt[] {
  if (waypoint && (waypoint.dx || waypoint.dy)) return elbowThrough(s, t, waypoint);
  const base = elbow(s, t);
  const expanded = obstacles.map((b) => expandBox(b, ROUTE_GAP));
  if (polylineClear(base, expanded)) return base;
  // Only boxes near the route can block it → keep the A* grid small.
  const bx0 = Math.min(s.x, t.x) - ROUTE_GAP * 3, by0 = Math.min(s.y, t.y) - ROUTE_GAP * 3;
  const bx1 = Math.max(s.x + s.w, t.x + t.w) + ROUTE_GAP * 3, by1 = Math.max(s.y + s.h, t.y + t.h) + ROUTE_GAP * 3;
  const near = obstacles.filter((b) => b.x < bx1 && b.x + b.w > bx0 && b.y < by1 && b.y + b.h > by0);
  return routeOrthogonal(s, t, near) ?? base;
}

const SHORTCUTS: [string, string][] = [
  ["Tab / Shift+Tab", "Move between parts"],
  ["Arrow keys", "Nudge the selected part"],
  ["Enter", "Rename the selected part"],
  ["Esc", "Cancel / deselect"],
  ["Delete", "Reset this part to original"],
  ["Ctrl/Cmd + Z", "Undo"],
  ["F", "Fit to view"],
  ["? ", "Show this help"],
];

export function SketchMap({ data, mermaid: aiMermaid, model, organizing, source, aiConfigured, onRegenerate, regenerating }: { data: SystemMap; mermaid?: string; model?: SimpleSketchModel; organizing?: boolean; source?: "ai" | "deterministic"; aiConfigured?: boolean; onRegenerate?: () => void; regenerating?: boolean }) {
  // AI-refined Mermaid from the server when available; otherwise a deterministic local one.
  // The deterministic one is ALSO the parse fallback (if the AI Mermaid is invalid).
  const fallbackMermaid = useMemo(() => dataToMermaid(data), [data]);
  const mermaid = aiMermaid ?? fallbackMermaid;
  const [scene, setScene] = useState<SketchScene | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gen = useMemo(() => rough.generator(), []);

  // Editable overlay state: per-node position overrides (drag) + label overrides (rename).
  // A presentation layer ON TOP of the projection — it never touches the technical graph.
  const [pos, setPos] = useState<Map<string, { x: number; y: number }>>(() => new Map());
  const [labels, setLabels] = useState<Map<string, string>>(() => new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const nodeDrag = useRef<{ id: string; px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  // Per-edge manual route offset (drag the edge handle to nudge it); presentation-only.
  const [edgeWaypoints, setEdgeWaypoints] = useState<Map<string, { dx: number; dy: number }>>(() => new Map());
  const edgeDrag = useRef<{ id: string; px: number; py: number; odx: number; ody: number; moved: boolean } | null>(null);

  // Keyboard focus + selection (one active part), hover, live announcements, help, undo.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [liveMsg, setLiveMsg] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const helpBtnRef = useRef<HTMLButtonElement>(null);
  const history = useRef<{ pos: Map<string, { x: number; y: number }>; labels: Map<string, string>; edges: Map<string, { dx: number; dy: number }> }[]>([]);
  const reduceMotion = useRef(false);
  useEffect(() => { reduceMotion.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; }, []);

  const boxMap = useMemo(() => {
    const m = new Map<string, Box>();
    if (scene) for (const el of scene.elements) {
      if (el.type === "arrow" || el.type === "line" || !el.id) continue;
      const o = pos.get(el.id);
      m.set(el.id, { x: o?.x ?? el.x, y: o?.y ?? el.y, w: el.width ?? 0, h: el.height ?? 0 });
    }
    return m;
  }, [scene, pos]);
  // Group regions (swimlanes): the bbox of each group's member boxes, recomputed from boxMap so they
  // hug their parts as nodes are dragged. The region IS the feature box — cross-feature arrows connect
  // to it (the group behaves as one box) and it carries the group's color. Behind everything, no input.
  const regions = useMemo(() => {
    const out: { id: string; name: string; color?: string; x: number; y: number; w: number; h: number }[] = [];
    if (!scene?.groups?.length) return out;
    const byG = new Map<string, Box[]>();
    for (const el of scene.elements) {
      if (el.type === "arrow" || el.type === "line" || !el.id || !el.group) continue;
      const b = boxMap.get(el.id); if (!b) continue;
      (byG.get(el.group) ?? byG.set(el.group, []).get(el.group)!).push(b);
    }
    const pad = 16, topPad = 22;
    for (const g of scene.groups) {
      const boxes = byG.get(g.id); if (!boxes || boxes.length === 0) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const b of boxes) { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); }
      out.push({ id: g.id, name: g.name, color: g.color, x: minX - pad, y: minY - pad - topPad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 + topPad });
    }
    return out;
  }, [scene, boxMap]);
  // One lookup for routing: node boxes PLUS each region keyed by its group id, so a cross-feature
  // arrow whose endpoint is a group id resolves to that group's region box.
  const routeBoxes = useMemo(() => {
    const m = new Map<string, Box>(boxMap);
    for (const r of regions) m.set(r.id, { x: r.x, y: r.y, w: r.w, h: r.h });
    return m;
  }, [boxMap, regions]);
  // Edge routes: recomputes only on box / region / waypoint / scene change — NOT on pan/zoom/clock,
  // so the draw-in stays cheap and a drag re-routes live. Intra-feature arrows dodge sibling node
  // boxes; cross-feature arrows treat each GROUP as one box and route AROUND the other group regions
  // (so the arrow exits the group at its boundary, never from an inner box).
  const edgeRoutes = useMemo(() => {
    const m = new Map<string, Pt[]>();
    if (!scene) return m;
    const groupIdSet = new Set(regions.map((r) => r.id));
    for (const el of scene.elements) {
      if (!(el.type === "arrow" || el.type === "line")) continue;
      const sid = el.start?.id, tid = el.end?.id;
      const s = sid ? routeBoxes.get(sid) : undefined;
      const t = tid ? routeBoxes.get(tid) : undefined;
      if (!s || !t) continue;
      const crossGroup = (!!sid && groupIdSet.has(sid)) || (!!tid && groupIdSet.has(tid));
      const obstacles = crossGroup
        ? regions.filter((r) => r.id !== sid && r.id !== tid).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
        : [...boxMap.entries()].filter(([bid]) => bid !== sid && bid !== tid).map(([, b]) => b);
      m.set(el.id ?? "", routeEdge(s, t, obstacles, edgeWaypoints.get(el.id ?? "")));
    }
    return m;
  }, [scene, boxMap, regions, routeBoxes, edgeWaypoints]);
  // Shape ids in flow order — the Tab traversal ring.
  const nodeIds = useMemo(() => scene ? scene.elements.filter((e) => e.type !== "arrow" && e.type !== "line" && e.id).map((e) => e.id!) : [], [scene]);
  const elById = useCallback((id: string) => scene?.elements.find((e) => (e.id ?? "") === id), [scene]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let els: Skel[] | null = null;
      let groups: SketchGroupMeta[] | undefined;
      // Preferred path: the structured model, laid out by ELK (Mermaid-free).
      if (model && model.nodes.length > 0) {
        try { const r = await modelToElements(model); els = r.els; groups = r.groups; } catch { els = null; }
      }
      // Fallback (until the model fully replaces it): the (AI) Mermaid, then the deterministic one.
      if (!els) {
        const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
        const sources = mermaid === fallbackMermaid ? [mermaid] : [mermaid, fallbackMermaid];
        for (const src of sources) {
          try {
            const r = await parseMermaidToExcalidraw(src, { themeVariables: { fontSize: "16px" } } as never);
            els = r.elements as unknown as Skel[];
            break;
          } catch { /* try the next source */ }
        }
      }
      if (cancelled) return;
      if (!els) { setErr("parse failed"); return; }
      setErr(null);
      // Draw order: follow the flow (box → its arrow → next box) so the diagram builds
      // itself in a way a person can follow, one focal point at a time.
      const ordered = flowOrder(els);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const e of ordered) {
        const xs = [e.x, ...(e.points?.map((p) => e.x + p[0]) ?? []), e.x + (e.width ?? 0)];
        const ys = [e.y, ...(e.points?.map((p) => e.y + p[1]) ?? []), e.y + (e.height ?? 0)];
        minX = Math.min(minX, ...xs); minY = Math.min(minY, ...ys);
        maxX = Math.max(maxX, ...xs); maxY = Math.max(maxY, ...ys);
      }
      // Pace the build so each element gets a clear moment without dragging on large maps.
      const stagger = clamp(3200 / Math.max(ordered.length, 1), 55, 200);
      setScene({ elements: ordered, minX, minY, w: maxX - minX, h: maxY - minY, stagger, groups });
    })();
    return () => { cancelled = true; };
  }, [model, mermaid, fallbackMermaid]);

  // INCREMENTAL draw-in clock. A monotonic time + a per-element "appeared" map: only NEW elements
  // animate in (staggered); unchanged elements stay fully drawn and are NOT re-rendered from scratch.
  // So an AI rename/recolor (same structure) re-animates NOTHING — labels/colors just update in place;
  // a graph change animates only the added parts. Honours prefers-reduced-motion (everything instant).
  const clockRef = useRef(0);
  const appearedRef = useRef(new Map<string, number>());
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!scene) return;
    const appeared = appearedRef.current;
    const present = new Set<string>();
    let fresh = 0;
    scene.elements.forEach((el, i) => {
      const id = el.id ?? String(i);
      present.add(id);
      if (!appeared.has(id)) appeared.set(id, reduceMotion.current ? -1e7 : clockRef.current + (fresh++) * scene.stagger);
    });
    for (const id of [...appeared.keys()]) if (!present.has(id)) appeared.delete(id);
    forceTick((x) => x + 1);
    if (reduceMotion.current || rafRef.current) return; // loop already running, or no animation
    lastTsRef.current = 0;
    const tick = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      clockRef.current += ts - lastTsRef.current; lastTsRef.current = ts;
      forceTick((x) => x + 1);
      const maxStart = appearedRef.current.size ? Math.max(...appearedRef.current.values()) : 0;
      if (clockRef.current < maxStart + DRAW_TOTAL) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = 0;
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [scene]);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // pan / zoom / fit
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const announce = useCallback((m: string) => setLiveMsg(m), []);
  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !scene || scene.w <= 0) return;
    const cw = el.clientWidth, ch = el.clientHeight, pad = 60;
    const k = clamp(Math.min((cw - pad * 2) / scene.w, (ch - pad * 2) / scene.h), 0.25, 1.6);
    setView({ k, x: (cw - scene.w * k) / 2 - scene.minX * k, y: (ch - scene.h * k) / 2 - scene.minY * k });
  }, [scene]);
  useEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top, dy = e.deltaY;
    setView((v) => { const k = clamp(v.k * Math.exp(-dy * 0.0015), 0.2, 3); return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k }; });
  };
  const onDown = (e: React.PointerEvent) => { wrapRef.current?.focus(); e.preventDefault(); drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    const nd = nodeDrag.current;
    if (nd) {
      if (!nd.moved) snapshot(); // first actual move → undo checkpoint
      const k = view.k; nd.moved = true;
      const nx = nd.ox + (e.clientX - nd.px) / k, ny = nd.oy + (e.clientY - nd.py) / k;
      setPos((prev) => new Map(prev).set(nd.id, { x: nx, y: ny }));
      return;
    }
    const ed = edgeDrag.current;
    if (ed) {
      if (!ed.moved) snapshot();
      ed.moved = true;
      const k = view.k;
      const dx = ed.odx + (e.clientX - ed.px) / k, dy = ed.ody + (e.clientY - ed.py) / k;
      setEdgeWaypoints((prev) => new Map(prev).set(ed.id, { dx, dy }));
      return;
    }
    const d = drag.current; if (!d) return;
    const nx = d.vx + (e.clientX - d.x), ny = d.vy + (e.clientY - d.y); setView((v) => ({ ...v, x: nx, y: ny }));
  };
  const onUp = () => {
    if (nodeDrag.current?.moved) announce("Moved");
    if (edgeDrag.current?.moved) announce("Re-routed");
    drag.current = null; nodeDrag.current = null; edgeDrag.current = null; setDraggingId(null);
  };
  const zoomBy = (factor: number) => {
    const el = wrapRef.current; if (!el) return;
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    setView((v) => { const k = clamp(v.k * factor, 0.2, 3); return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k }; });
  };

  // — overrides + history (presentation only; never the graph) —
  const snapshot = () => { history.current.push({ pos: new Map(pos), labels: new Map(labels), edges: new Map(edgeWaypoints) }); if (history.current.length > 50) history.current.shift(); };
  const focusNode = (id: string) => { setActiveId(id); nodeRefs.current.get(id)?.focus(); };
  const nudge = (id: string, dx: number, dy: number) => { const b = boxMap.get(id); if (!b) return; snapshot(); setPos((p) => new Map(p).set(id, { x: b.x + dx, y: b.y + dy })); announce("Moved"); };
  const resetOne = (id: string) => { snapshot(); setPos((p) => { const m = new Map(p); m.delete(id); return m; }); setLabels((l) => { const m = new Map(l); m.delete(id); return m; }); announce("Reset to original"); };
  const resetAll = () => { snapshot(); setPos(new Map()); setLabels(new Map()); setEdgeWaypoints(new Map()); announce("All parts reset to original"); fit(); };
  const undo = () => { const snap = history.current.pop(); if (!snap) return; setPos(snap.pos); setLabels(snap.labels); setEdgeWaypoints(snap.edges); announce("Undo"); };

  // Drag a node (edges re-route live); double-click / Enter to rename it.
  const onNodeDown = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const b = boxMap.get(id); if (!b) return;
    focusNode(id);
    setDraggingId(id);
    nodeDrag.current = { id, px: e.clientX, py: e.clientY, ox: b.x, oy: b.y, moved: false };
    wrapRef.current?.setPointerCapture(e.pointerId);
  };
  // Drag an edge by its handle to nudge/re-route it (stores a manual via-offset).
  const onEdgeDown = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const cur = edgeWaypoints.get(id) ?? { dx: 0, dy: 0 };
    edgeDrag.current = { id, px: e.clientX, py: e.clientY, odx: cur.dx, ody: cur.dy, moved: false };
    setDraggingId(id);
    wrapRef.current?.setPointerCapture(e.pointerId);
  };
  const startEdit = (id: string, current: string) => { setEditing(id); setDraft(current); announce("Editing label"); };
  const commitEdit = () => {
    if (editing !== null) { const id = editing, v = draft.trim(); snapshot(); setLabels((prev) => new Map(prev).set(id, v)); announce(v ? "Renamed to " + v : "Label cleared"); setEditing(null); nodeRefs.current.get(id)?.focus(); }
    else setEditing(null);
  };
  const cancelEdit = () => { const id = editing; setEditing(null); announce("Edit cancelled"); if (id) nodeRefs.current.get(id)?.focus(); };

  // All shortcuts live on the focused diagram (role=application), not the window — they
  // only fire when the sketch has focus, so they never hijack the rest of the page.
  const onWrapKeyDown = (e: React.KeyboardEvent) => {
    if (editing !== null) return; // the rename input owns its own keys
    const k = e.key;
    if (k === "?") { e.preventDefault(); setHelpOpen((o) => !o); return; }
    if (k === "Escape") { if (helpOpen) { setHelpOpen(false); helpBtnRef.current?.focus(); } else if (activeId) { setActiveId(null); announce("Deselected"); } return; }
    if (k === "f" || k === "F") { e.preventDefault(); fit(); announce("Fit to view"); return; }
    if (k === "Tab") {
      if (!nodeIds.length) return;
      e.preventDefault();
      const cur = activeId ? nodeIds.indexOf(activeId) : -1;
      const dir = e.shiftKey ? -1 : 1;
      focusNode(nodeIds[(cur + dir + nodeIds.length) % nodeIds.length]);
      return;
    }
    if (!activeId) return;
    if (k === "Enter") { e.preventDefault(); const el = elById(activeId); startEdit(activeId, labels.get(activeId) ?? (el ? labelText(el) : "")); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); resetOne(activeId); return; }
    if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z")) { e.preventDefault(); undo(); return; }
    const step = e.shiftKey ? 10 : 2;
    let dx = 0, dy = 0;
    if (k === "ArrowLeft") dx = -step; else if (k === "ArrowRight") dx = step; else if (k === "ArrowUp") dy = -step; else if (k === "ArrowDown") dy = step; else return;
    e.preventDefault();
    nudge(activeId, dx, dy);
  };

  // Screen-space anchor for the inline rename input (follows pan/zoom).
  const editAnchor = useMemo(() => {
    if (editing === null || !scene) return null;
    const el = scene.elements.find((e) => (e.id ?? "") === editing);
    if (!el) return null;
    let cx: number, cy: number;
    if (el.type === "arrow" || el.type === "line") {
      const s = el.start?.id ? routeBoxes.get(el.start.id) : undefined;
      const t = el.end?.id ? routeBoxes.get(el.end.id) : undefined;
      if (s && t) { const p = edgeRoutes.get(editing) ?? elbow(s, t); const m = Math.floor(p.length / 2); cx = (p[m - 1][0] + p[m][0]) / 2; cy = (p[m - 1][1] + p[m][1]) / 2; }
      else { cx = el.x; cy = el.y; }
    } else {
      const b = boxMap.get(editing) ?? { x: el.x, y: el.y, w: el.width ?? 0, h: el.height ?? 0 };
      cx = b.x + b.w / 2; cy = b.y + b.h / 2;
    }
    return { x: view.x + cx * view.k, y: view.y + cy * view.k };
  }, [editing, scene, boxMap, routeBoxes, view, edgeRoutes]);
  const editEl = editing !== null ? elById(editing) : undefined;
  const editIsEdge = editEl?.type === "arrow" || editEl?.type === "line";
  const hasOverrides = pos.size > 0 || labels.size > 0 || edgeWaypoints.size > 0;

  const stats = useMemo(() => {
    let things = 0, open = 0;
    const exts = new Set<string>();
    for (const f of data.features) { things += f.capabilities.length; for (const c of f.capabilities) if (c.actor === "Any user") open++; for (const e of f.external ?? []) exts.add(e); }
    return { parts: data.features.length, things, open, exts: [...exts].sort() };
  }, [data]);

  const exportSvg = () => {
    const svg = wrapRef.current?.querySelector("svg");
    if (!svg || !scene) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const pad = 40;
    clone.setAttribute("viewBox", `${scene.minX - pad} ${scene.minY - pad} ${scene.w + pad * 2} ${scene.h + pad * 2}`);
    clone.setAttribute("width", String(scene.w + pad * 2));
    clone.setAttribute("height", String(scene.h + pad * 2));
    clone.querySelector("g")?.removeAttribute("transform");
    const cs = getComputedStyle(document.documentElement);
    const toks = ["--paper", "--paper-raised", "--paper-sunken", "--ink", "--ink-soft", "--ink-faint", "--accent", "--accent-wash", "--border"];
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `:root{${toks.map((t) => `${t}:${cs.getPropertyValue(t).trim()}`).join(";")}}text{font-family:ui-sans-serif,system-ui,sans-serif}`;
    clone.insertBefore(style, clone.firstChild);
    const blob = new Blob([`<?xml version="1.0"?>\n${new XMLSerializer().serializeToString(clone)}`], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "system-sketch.svg"; a.click();
    URL.revokeObjectURL(url);
  };

  if (err) return <Centered>This sketch could not be drawn yet.</Centered>;
  if (!scene) return <Centered>sketching the system…</Centered>;

  const resolveLabel = (id?: string) => {
    if (!id) return "";
    const e = scene.elements.find((x) => (x.id ?? "") === id);
    if (e) return labels.get(id) ?? labelText(e);
    return scene.groups?.find((g) => g.id === id)?.name ?? ""; // group-id endpoint (cross-feature arrow)
  };
  const btn = "flex h-7 w-7 items-center justify-center text-[color:var(--ink-soft)] outline-none transition-colors hover:text-[color:var(--ink)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]";

  return (
    <div
      ref={wrapRef}
      role="application"
      aria-roledescription="diagram"
      aria-label="Interactive system sketch. Tab between parts, arrow keys to move, Enter to rename, Delete to reset, F to fit, question mark for help."
      tabIndex={0}
      className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--accent)]"
      style={{ WebkitTouchCallout: "none", WebkitTapHighlightColor: "transparent" }}
      onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onWrapKeyDown}
    >
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* grouping backdrops (swimlanes) — soft, behind everything; fade in as the sketch draws */}
          {regions.length > 0 && (
            <g aria-hidden="true" pointerEvents="none" opacity={clamp01(clockRef.current / 350)}>
              {regions.map((r) => {
                const hue = r.color ? SEMANTIC_HUE[r.color] ?? "var(--ink-faint)" : "var(--ink-faint)";
                return (
                  <g key={"r_" + r.id}>
                    <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={12} fill={hue} fillOpacity={0.05} stroke={hue} strokeOpacity={0.25} strokeWidth={1.2} />
                    <text x={r.x + 12} y={r.y + 15} fontSize={10.5} fill={hue} fillOpacity={0.8} style={{ fontFamily: "var(--font-sans, sans-serif)", letterSpacing: "0.05em" }}>{r.name.toUpperCase()}</text>
                  </g>
                );
              })}
            </g>
          )}
          {scene.elements.map((el, i) => {
            const id = el.id ?? String(i);
            const isEdge = el.type === "arrow" || el.type === "line";
            let pts: [number, number][] | undefined;
            let box: Box | undefined;
            let ariaLabel: string;
            if (isEdge) {
              pts = edgeRoutes.get(id) ?? (el.points ?? [[0, 0], [el.width ?? 0, el.height ?? 0]]).map((p) => [el.x + p[0], el.y + p[1]] as [number, number]);
              const lab = labels.get(id) ?? labelText(el);
              ariaLabel = `Connection${lab ? ": " + lab : ""} from ${resolveLabel(el.start?.id) || "a part"} to ${resolveLabel(el.end?.id) || "a part"}`;
            } else {
              box = boxMap.get(id) ?? { x: el.x, y: el.y, w: el.width ?? 0, h: el.height ?? 0 };
              const lab = labels.get(id) ?? labelText(el);
              ariaLabel = lab || kindWord(el.type);
            }
            const label = labels.get(id) ?? labelText(el);
            return (
              <SketchElement
                key={id} el={el} gen={gen} local={clockRef.current - (appearedRef.current.get(id) ?? Infinity)}
                box={box} pts={pts} label={label} muteLabel={editing === id} ariaLabel={ariaLabel}
                isActive={activeId === id} isHover={hoverId === id} isDragging={draggingId === id}
                hasOverride={pos.has(id) || labels.has(id)}
                tabIndex={isEdge ? undefined : (activeId === id ? 0 : -1)}
                registerRef={isEdge ? undefined : (g) => { if (g) nodeRefs.current.set(id, g); else nodeRefs.current.delete(id); }}
                onFocus={isEdge ? undefined : () => setActiveId(id)}
                onDown={isEdge ? onEdgeDown(id) : onNodeDown(id)} onEdit={() => startEdit(id, label)}
                onEnter={() => setHoverId(id)} onLeave={() => setHoverId((h) => (h === id ? null : h))}
              />
            );
          })}
        </g>
      </svg>

      {/* AI two-phase indicator — structure is shown; the AI is refining names + colors */}
      {organizing && (
        <div role="status" className="pointer-events-none absolute left-1/2 top-9 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[color:var(--paper)] px-2.5 py-1 text-[12px] text-[color:var(--ink-soft)] shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)] motion-safe:animate-pulse" />
          Organizing the diagram…
        </div>
      )}

      {/* live region — announces drag / rename / fit / reset to assistive tech */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{liveMsg}</div>
      <span id="sketch-rename-hint" className="sr-only">Enter to save, Escape to cancel.</span>

      {/* inline rename (node + edge) — a presentation overlay that never edits the graph */}
      {editing !== null && editAnchor && (
        <input
          autoFocus value={draft}
          aria-label={editIsEdge ? "Edit connection label" : "Edit part name"}
          aria-describedby="sketch-rename-hint"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); } }}
          onBlur={commitEdit}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-md border border-[color:var(--accent)] bg-[color:var(--paper)] px-2 py-1 text-center text-[13px] text-[color:var(--ink)] shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
          style={{ left: editAnchor.x, top: editAnchor.y, minWidth: 90, maxWidth: 260 }}
        />
      )}

      {/* Executive readout (chrome; never pans) */}
      <div role="status" aria-live="polite" className="pointer-events-none absolute left-1/2 top-3 z-10 max-w-[80%] -translate-x-1/2 text-center">
        <p className="font-sans text-[13px] leading-snug text-[color:var(--ink)]">
          <b className="font-semibold tabular-nums">{stats.parts}</b> parts · <b className="font-semibold tabular-nums">{stats.things}</b> things people can do
          {stats.open > 0 && <> · <span className="tabular-nums">{stats.open}</span> open to anyone</>}
          {stats.exts.length > 0 && <> · connects to {stats.exts.join(", ")}</>}
        </p>
      </div>

      {/* left controls: export + regenerate + reset (reset only when there are overrides) */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
        <button type="button" onClick={exportSvg} title="Download as SVG" aria-label="Download as SVG" className={"rounded-lg border border-[hsl(var(--border))] bg-[color:var(--paper)] " + btn}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M7 2v7M4 6.5 7 9.5l3-3M2.5 11.5h9" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {onRegenerate && (
          <button
            type="button" onClick={onRegenerate} disabled={regenerating}
            title={aiConfigured === false ? "Rebuild the diagram (AI is off — set DEEPSEEK_API_KEY to get friendly names + colors)" : "Regenerate — re-run the AI to refine names + colors"}
            aria-label="Regenerate the diagram"
            className="flex h-7 items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[color:var(--paper)] px-2 text-[12px] text-[color:var(--ink-soft)] outline-none transition-colors hover:text-[color:var(--ink)] disabled:cursor-default disabled:opacity-60 cursor-pointer focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true" className={regenerating ? "motion-safe:animate-spin" : ""}><path d="M12 7a5 5 0 1 1-1.5-3.6M12 2.5V5H9.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        )}
        {/* AI state — honest, plain (no badge): is the AI on, and did it refine this diagram? */}
        {!regenerating && aiConfigured !== undefined && (
          <span className="font-sans text-[11px] text-[color:var(--ink-faint)]" title={aiConfigured ? (source === "ai" ? "AI refined the names + colors" : "AI is configured but this diagram is the plain structure — Regenerate to retry") : "AI is off (DEEPSEEK_API_KEY not set) — showing the plain structure"}>
            {aiConfigured ? (source === "ai" ? "AI refined" : "AI: plain structure") : "AI off"}
          </span>
        )}
        {hasOverrides && (
          <button type="button" onClick={resetAll} title="Reset all to original" aria-label="Reset all parts to original" className="flex h-7 items-center gap-1 rounded-lg border border-[hsl(var(--border))] bg-[color:var(--paper)] px-2 text-[12px] text-[color:var(--ink-soft)] outline-none transition-colors hover:text-[color:var(--ink)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M3 7a4 4 0 1 1 1.2 2.8M3 7V4.5M3 7h2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Reset
          </button>
        )}
      </div>

      {/* right controls: zoom + fit + help */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
        <button ref={helpBtnRef} type="button" onClick={() => setHelpOpen((o) => !o)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" aria-expanded={helpOpen} className={"rounded-lg border border-[hsl(var(--border))] bg-[color:var(--paper)] " + btn}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M5.2 5.2a1.8 1.8 0 1 1 2.6 1.6c-.5.3-.8.6-.8 1.2M7 10.4h.01" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="flex items-center rounded-lg border border-[hsl(var(--border))] bg-[color:var(--paper)]">
          <button type="button" onClick={() => zoomBy(0.8)} title="Zoom out" aria-label="Zoom out" className={btn}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.4" /></svg></button>
          <button type="button" onClick={fit} title="Fit (F)" aria-label="Fit to view" aria-keyshortcuts="f" className={"border-x border-[hsl(var(--border))] " + btn}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9" strokeLinecap="round" /></svg></button>
          <button type="button" onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in" className={btn}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.4" /><line x1="7" y1="3" x2="7" y2="11" stroke="currentColor" strokeWidth="1.4" /></svg></button>
        </div>
      </div>

      {/* keyboard shortcuts panel (plain surface — no glass/gradient) */}
      {helpOpen && (
        <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="absolute bottom-12 right-3 z-20 w-64 rounded-lg border border-[hsl(var(--border))] bg-[color:var(--paper)] p-3 shadow-md">
          <p className="mb-2 font-sans text-[12px] font-semibold text-[color:var(--ink)]">Keyboard shortcuts</p>
          <dl className="space-y-1.5">
            {SHORTCUTS.map(([keys, desc]) => (
              <div key={keys} className="flex items-center justify-between gap-3">
                <dd className="font-sans text-[12px] text-[color:var(--ink-soft)]">{desc}</dd>
                <dt><kbd className="rounded border border-[hsl(var(--border))] bg-[color:var(--paper-raised)] px-1.5 py-0.5 font-mono text-[11px] text-[color:var(--ink)]">{keys.trim()}</kbd></dt>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

const INK = "var(--ink)";
/** AI semantic colors → a single mid-tone hue per name that reads on both light paper and dark
 *  zen (used as the box outline at rest; no heavy fills/gradients — calm, not slop). */
const SEMANTIC_HUE: Record<string, string> = {
  blue: "#4f7fd6", green: "#3f9d63", orange: "#e0853a", purple: "#8568cf", red: "#d0524e", teal: "#2f9d92", gray: "#8a8784",
};

function SketchElement(props: {
  el: Skel; gen: ReturnType<typeof rough.generator>; local: number;
  box?: Box; pts?: [number, number][]; label: string; muteLabel?: boolean; ariaLabel: string;
  isActive?: boolean; isHover?: boolean; isDragging?: boolean; hasOverride?: boolean;
  tabIndex?: number; registerRef?: (g: SVGGElement | null) => void;
  onDown?: (e: React.PointerEvent) => void; onEdit?: () => void;
  onEnter?: () => void; onLeave?: () => void; onFocus?: () => void;
}) {
  const { el, gen, local, box, pts: arrowPts, label, muteLabel, ariaLabel, isActive, isHover, isDragging, hasOverride, tabIndex, registerRef, onDown, onEdit, onEnter, onLeave, onFocus } = props;
  if (local <= 0) return null; // hasn't started drawing yet (staggered appearance)
  const seed = hashSeed(el.id ?? `${el.type}${el.x}${el.y}`);
  const text = muteLabel ? "" : label;
  const sp = clamp01(local / STROKE_MS);                    // outline draws on
  const fp = clamp01((local - STROKE_MS * 0.55) / 260);     // fill fades in
  const tp = clamp01((local - STROKE_MS * 0.85) / TEXT_MS); // text types in

  if (el.type === "arrow" || el.type === "line") {
    const pts = arrowPts ?? ([[el.x, el.y], [el.x + (el.width ?? 0), el.y + (el.height ?? 0)]] as [number, number][]);
    // Low roughness / no bowing keeps the right-angle elbow crisp (still hand-drawn).
    const draw = gen.linearPath(pts, { seed, roughness: 0.8, stroke: "var(--ink-soft)", strokeWidth: 1.4, bowing: 0 });
    const paths = gen.toPaths(draw);
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const dash = len * 1.3 + 1;
    const last = pts[pts.length - 1], prev = pts[pts.length - 2] ?? pts[0];
    const ang = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
    const ah = 8;
    const a1 = [last[0] - ah * Math.cos(ang - 0.45), last[1] - ah * Math.sin(ang - 0.45)];
    const a2 = [last[0] - ah * Math.cos(ang + 0.45), last[1] - ah * Math.sin(ang + 0.45)];
    const mi = Math.floor(pts.length / 2);
    const mid = pts.length >= 2 ? [(pts[mi - 1][0] + pts[mi][0]) / 2, (pts[mi - 1][1] + pts[mi][1]) / 2] : pts[0];
    const headOp = clamp01((local - STROKE_MS) / 140);
    const edgeStroke = isHover ? "var(--accent)" : "var(--ink-soft)";
    return (
      <g role="img" aria-label={ariaLabel}>
        {paths.map((p, i) => (
          <g key={i}>
            <path d={p.d} fill="none" stroke={isHover ? "var(--accent)" : p.stroke} strokeWidth={p.strokeWidth + (isHover ? 0.5 : 0)} strokeDasharray={dash} strokeDashoffset={dash * (1 - sp)} strokeLinecap="round" strokeLinejoin="round" />
            {sp < 1 && <path aria-hidden="true" d={p.d} fill="none" stroke="var(--accent)" strokeWidth={p.strokeWidth + 0.3} strokeDasharray={dash} strokeDashoffset={dash * (1 - sp)} strokeLinecap="round" strokeLinejoin="round" opacity={(1 - sp) * 0.85} />}
          </g>
        ))}
        <path aria-hidden="true" d={`M${last[0]},${last[1]} L${a1[0]},${a1[1]} M${last[0]},${last[1]} L${a2[0]},${a2[1]}`} stroke={edgeStroke} strokeWidth={1.4} fill="none" strokeLinecap="round" opacity={headOp} />
        {text && tp > 0 && (
          <text x={mid[0]} y={mid[1] - 4} textAnchor="middle" fontSize={12} fill="var(--ink-soft)" opacity={tp} pointerEvents="none" style={{ fontFamily: "var(--font-sketch, var(--font-sans, sans-serif))" }}>{text}</text>
        )}
        {onDown && <path d={"M" + pts.map((p) => `${p[0]},${p[1]}`).join(" L")} fill="none" stroke="transparent" strokeWidth={16} pointerEvents="stroke" style={{ cursor: isDragging ? "grabbing" : "grab" }} onPointerDown={onDown} onDoubleClick={onEdit} onPointerEnter={onEnter} onPointerLeave={onLeave} />}
        {/* grab handle — one accent dot (no badge/glass): full on hover/drag, faint at rest when unlabeled, fades in after the line draws */}
        <circle aria-hidden="true" cx={mid[0]} cy={mid[1]} r={isHover || isDragging ? 5 : 3.5} fill={isHover || isDragging ? "var(--accent)" : "var(--paper)"} stroke="var(--accent)" strokeWidth={1.4} pointerEvents="none" opacity={(isHover || isDragging ? 1 : text ? 0 : 0.55) * clamp01((local - STROKE_MS) / 200)} style={{ transition: "r 120ms" }} />
      </g>
    );
  }

  // shapes: rectangle / ellipse / diamond — positioned by the (draggable) box.
  const b = box ?? { x: el.x, y: el.y, w: el.width ?? 0, h: el.height ?? 0 };
  const { x, y, w, h } = b;
  const accent = isActive || isHover;
  const baseStroke = el.color ? SEMANTIC_HUE[el.color] ?? INK : INK;
  const stroke = accent ? "var(--accent)" : baseStroke;
  const sw = 1.5 + (isActive ? 0.9 : isHover ? 0.6 : 0);
  const fill = isHover ? "var(--accent-wash)" : (el.type === "diamond" ? "var(--accent-wash)" : "var(--paper-raised)");
  const opt = { seed, strokeWidth: sw, stroke, fill, fillStyle: "solid" as const };
  let drawables;
  if (el.type === "ellipse") drawables = [gen.ellipse(x + w / 2, y + h / 2, w, h, { ...opt, roughness: 1.1 })];
  else if (el.type === "diamond") drawables = [gen.polygon([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], { ...opt, roughness: 1.1 })];
  else if (el.type === "parallelogram") { const sk = Math.min(h * 0.42, 18); drawables = [gen.polygon([[x + sk, y], [x + w, y], [x + w - sk, y + h], [x, y + h]], { ...opt, roughness: 1.1 })]; }
  else if (el.type === "cylinder") { const ry = Math.min(h * 0.17, 13); drawables = [gen.rectangle(x, y + ry, w, h - ry, { ...opt, roughness: 1 }), gen.ellipse(x + w / 2, y + ry, w, 2 * ry, { ...opt, seed: seed + 1, roughness: 1 })]; }
  else drawables = [gen.rectangle(x, y, w, h, { ...opt, roughness: 1 })];
  const paths = drawables.flatMap((d) => gen.toPaths(d));
  const dash = 2 * (w + h) * 1.5 + 1;
  const shown = text.length > 22 ? text.slice(0, 21) + "…" : text;
  const typed = shown.slice(0, Math.ceil(tp * shown.length));
  return (
    <g
      ref={registerRef} role="button" aria-label={ariaLabel + (hasOverride ? ", edited" : "")} aria-selected={!!isActive}
      tabIndex={tabIndex} onFocus={onFocus} style={{ outline: "none" }}
    >
      {/* in-flight lift while dragging — a faint offset of the outline, no shadow chrome */}
      {isDragging && (
        <g aria-hidden="true" opacity={0.22} transform="translate(0,3)">
          {paths.filter((p) => !(p.fill && p.fill !== "none")).map((p, i) => <path key={`lift${i}`} d={p.d} fill="none" stroke={INK} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />)}
        </g>
      )}
      {paths.map((p, i) => {
        const isFill = !!p.fill && p.fill !== "none";
        if (isFill) return <path key={i} aria-hidden="true" d={p.d} fill={p.fill} stroke="none" opacity={fp} />;
        return (
          <g key={i}>
            <path d={p.d} fill="none" stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={dash} strokeDashoffset={dash * (1 - sp)} strokeLinecap="round" strokeLinejoin="round" />
            {sp < 1 && <path aria-hidden="true" d={p.d} fill="none" stroke="var(--accent)" strokeWidth={p.strokeWidth + 0.4} strokeDasharray={dash} strokeDashoffset={dash * (1 - sp)} strokeLinecap="round" strokeLinejoin="round" opacity={(1 - sp) * 0.85} />}
          </g>
        );
      })}
      {text && tp > 0 && (
        <text aria-hidden="true" pointerEvents="none" x={x + w / 2} y={y + h / 2 + 5} textAnchor="middle" fontSize={14} fill="var(--ink)" style={{ fontFamily: "var(--font-sketch, var(--font-sans, sans-serif))" }}>{typed}</text>
      )}
      {/* focus / selection ring (2px accent, 4px offset — the keyboard indicator) */}
      {isActive && <rect aria-hidden="true" x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={8} fill="none" stroke="var(--accent)" strokeWidth={2} pointerEvents="none" />}
      {/* override marker — a plain accent dot (not a pill/badge): moved or renamed, not saved */}
      {hasOverride && tp > 0 && <circle aria-hidden="true" cx={x + w} cy={y} r={3} fill="var(--accent)" pointerEvents="none" />}
      {/* hit surface: drag to move, double-click to rename */}
      <rect x={x} y={y} width={w} height={h} rx={6} fill="transparent" pointerEvents="all" style={{ cursor: "move" }} onPointerDown={onDown} onDoubleClick={onEdit} onPointerEnter={onEnter} onPointerLeave={onLeave} />
    </g>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[color:var(--paper)] px-6 text-center">
      <p className="font-mono text-[13px] text-[color:var(--ink-faint)] animate-in fade-in duration-200">{children}</p>
    </div>
  );
}
