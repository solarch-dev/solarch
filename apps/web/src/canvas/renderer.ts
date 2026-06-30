import type { Scene, SceneEdge, SceneNode, Viewport, FocusSet } from "./types";
import { ANIM_NODE_POP_MS, ANIM_EDGE_FADE_MS, ANIM_EDGE_DELAY_MS, FOCUS_DIM_ALPHA } from "./types";
import { colorOfFamily, familyOf } from "./families";
import { getEdgeStyle, type MarkerKind } from "./edge-style";
import { NODE_FA_ICON } from "../lib/node-icons";

// ── AI streaming pop/fade — zen ease-out-quart, no bounce ─────────
const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);

/** Node enterT (0=just spawned, 1=fully visible). undefined → 1 (settled). */
export function nodeEnterT(n: SceneNode, now: number): number {
  if (n.enterStart === undefined) return 1;
  const t = (now - n.enterStart) / ANIM_NODE_POP_MS;
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  return easeOutQuart(t);
}

/** Edge enterT (fade after delay). undefined → 1. */
export function edgeEnterT(e: SceneEdge, now: number): number {
  if (e.enterStart === undefined) return 1;
  const t = (now - e.enterStart - ANIM_EDGE_DELAY_MS) / ANIM_EDGE_FADE_MS;
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  return easeOutQuart(t);
}

// ── Theme-aware palette ───────────────────────────────────────────
// Surfaces/ink/grid are read from CSS variables ONCE per render pass (refreshPalette,
// called at drawScene start). The canvas then follows the <html>.dark switch with NO
// duplicate hardcoded dark set — single source of truth is index.css. Family colors
// (families.ts) and semantic accents stay constant (they pop on both themes).
const PAL = {
  paper: "#fafaf7",
  card: "#ffffff",
  bodyBg: "#fcfcfa",
  nodeBorder: "rgba(11, 16, 32, 0.10)",
  hairline: "rgba(11, 16, 32, 0.08)",
  rowDivider: "rgba(11, 16, 32, 0.06)",
  inkHex: "#1b1b1a",
  inkSoft: "#64748b",
  inkFaint: "#94a3b8",
  inkRgb: "27, 27, 26",
  ink85: "rgba(27, 27, 26, 0.85)",
  ink90: "rgba(27, 27, 26, 0.90)",
  gridRgb: "37, 99, 235",
  shadowRgb: "11, 16, 32",
  dark: false,
};

/** Pull palette from CSS variables. Call once per render pass (cheap: one getComputedStyle). */
function refreshPalette(): void {
  if (typeof window === "undefined") return;
  PAL.dark = document.documentElement.classList.contains("dark");
  PAL.shadowRgb = PAL.dark ? "0, 0, 0" : "11, 16, 32";
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  PAL.paper = v("--paper", PAL.paper);
  PAL.card = v("--canvas-card", PAL.card);
  PAL.bodyBg = v("--canvas-body", PAL.bodyBg);
  PAL.nodeBorder = v("--canvas-node-border", PAL.nodeBorder);
  PAL.hairline = v("--canvas-hairline", PAL.hairline);
  PAL.rowDivider = v("--canvas-row-divider", PAL.rowDivider);
  PAL.inkHex = v("--ink", PAL.inkHex);
  PAL.inkSoft = v("--ink-soft", PAL.inkSoft);
  PAL.inkFaint = v("--ink-faint", PAL.inkFaint);
  PAL.inkRgb = v("--canvas-ink-rgb", PAL.inkRgb);
  PAL.ink85 = `rgba(${PAL.inkRgb}, 0.85)`;
  PAL.ink90 = `rgba(${PAL.inkRgb}, 0.90)`;
  PAL.gridRgb = v("--canvas-grid-rgb", PAL.gridRgb);
}

/** Edge semantic colors are tuned for the LIGHT canvas; on the dark/zen-gray field the
 *  500-600 tones go muted. Brighten to the 300-400 tone in dark so edges stay distinct.
 *  Map is keyed by the light hex (edge-style.ts); unknown colors pass through. */
const EDGE_DARK: Record<string, string> = {
  "#4f46e5": "#818cf8", // indigo-600 → 400 (CALLS/REQUESTS)
  "#6366f1": "#a5b4fc", // indigo-500 → 300 (ROUTES_TO)
  "#7c3aed": "#a78bfa", // violet-600 → 400 (PUBLISHES/SUBSCRIBES)
  "#0891b2": "#22d3ee", // cyan-600 → 400 (QUERIES/WRITES)
  "#ea580c": "#fb923c", // orange-600 → 400 (CACHES_IN)
  "#16a34a": "#4ade80", // green-600 → 400 (READS_CONFIG)
  "#64748b": "#94a3b8", // slate-500 → 400 (USES/HAS/RETURNS)
  "#475569": "#94a3b8", // slate-600 → 400 (EXTENDS/IMPLEMENTS — was too dark)
  "#94a3b8": "#cbd5e1", // slate-400 → 300 (DEPENDS_ON)
  "#d97706": "#fbbf24", // amber-600 → 400 (THROWS)
  "#c92a2a": "#f87171", // invalid red → red-400
};

/** Theme-aware edge color — brightened on dark, unchanged on light. */
function edgeColor(hex: string): string {
  return PAL.dark ? (EDGE_DARK[hex.toLowerCase()] ?? hex) : hex;
}

/** The 8 node-family colors are saturated on the light theme (500-600); on the dark field
 *  they must be desaturated+lighter (300-400 / Material 200), else a "neon rainbow" dominates
 *  (deep-research). Light hex → dark hex. */
const FAMILY_DARK: Record<string, string> = {
  "#3b82f6": "#7da7e8", // data — blue, softened
  "#10b981": "#54c79e", // business — emerald, softened
  "#f97316": "#f59a5c", // access — orange, softened
  "#0891b2": "#4fb4c6", // infrastructure — cyan, softened
  "#c026d3": "#cd78d6", // client — fuchsia, softened
  "#8b5cf6": "#a991ec", // security — violet, softened
  "#d97706": "#dcab63", // configuration — amber, softened
  "#6b7280": "#99a0ac", // structure — slate, lightened
};

/** Theme-aware family color — desaturated/lightened on dark, unchanged on light. */
function famColor(hex: string): string {
  return PAL.dark ? (FAMILY_DARK[hex.toLowerCase()] ?? hex) : hex;
}

const GRID_SIZE = 28;
const LABEL_MIN_ZOOM = 0.55;

// ── Node layout constants (world px) ────────────────────────────
const HEADER_H = 56;     // header area height
const ROW_H = 26;        // single body row height (px-3 py-1.5 ≈ 26px)
const MAX_ROWS = 5;
const BORDER_R = 12;     // 12px rounded corners (matches web_old rounded-[12px])

export type EdgePathMode = "bezier" | "straight" | "elbow";

/** Crossing hop (circuit-diagram "jump") — world coordinate + the polyline segment
 *  index it belongs to and the parameter along the segment (for draw order). */
export interface EdgeHop {
  x: number;
  y: number;
  seg: number;
  t: number;
}

const sx = (wx: number, vp: Viewport) => wx * vp.zoom + vp.x;
const sy = (wy: number, vp: Viewport) => wy * vp.zoom + vp.y;

/** Cross-browser rounded rectangle path. */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// ── Preview rows ─────────────────────────────────────────────────

type PreviewRow =
  | { kind: "column";    name: string; colType: string; tags: string[] }
  | { kind: "method";    name: string; isAsync: boolean; paramCount: number }
  | { kind: "endpoint";  method: string; path: string }
  | { kind: "field";     name: string; fieldType: string; required: boolean }
  | { kind: "enum-value"; value: string }
  | { kind: "kv";        label: string; value: string }
  | { kind: "more";      count: number }
  | { kind: "summary";   text: string };

function previewRows(n: SceneNode): PreviewRow[] {
  const p = n.properties ?? {};
  const rows: PreviewRow[] = [];

  switch (n.type) {
    case "Table": {
      const cols = Array.isArray(p.Columns) ? (p.Columns as Array<Record<string, unknown>>) : [];

      // FK membership is now derived from table-level ForeignKeys[].Columns, not per-column IsForeignKey.
      const fkCols = new Set<string>();
      if (Array.isArray(p.ForeignKeys)) {
        for (const fk of p.ForeignKeys as Array<Record<string, unknown>>) {
          if (Array.isArray(fk.Columns)) for (const c of fk.Columns) fkCols.add(String(c));
        }
      }

      // Constraint summary (footer) — only show counts > 0.
      const idxN = Array.isArray(p.Indexes) ? p.Indexes.length : 0;
      const chkN = Array.isArray(p.CheckConstraints) ? p.CheckConstraints.length : 0;
      const uqN = Array.isArray(p.UniqueConstraints) ? p.UniqueConstraints.length : 0;
      const summaryParts: string[] = [];
      if (idxN > 0) summaryParts.push(`${idxN} idx`);
      if (chkN > 0) summaryParts.push(`${chkN} chk`);
      if (uqN > 0) summaryParts.push(`${uqN} uq`);
      const hasSummary = summaryParts.length > 0;

      // Column rows — if summary exists, reserve one row for it, compress rest with "+N more".
      const colBudget = MAX_ROWS - (hasSummary ? 1 : 0);
      const colRows: PreviewRow[] = cols.map((c) => {
        const tags: string[] = [];
        if (c.IsPrimaryKey) tags.push("PK");
        if (fkCols.has(String(c.Name ?? ""))) tags.push("FK");
        if (c.IsNotNull && !c.IsPrimaryKey) tags.push("NN");
        if (c.IsUnique && !c.IsPrimaryKey) tags.push("UQ");
        return { kind: "column", name: String(c.Name ?? ""), colType: String(c.DataType ?? ""), tags };
      });
      if (colRows.length > colBudget) {
        const extra = colRows.length - colBudget + 1;
        colRows.splice(colBudget - 1, colRows.length, { kind: "more", count: extra });
      }

      rows.push(...colRows);
      if (hasSummary) rows.push({ kind: "summary", text: summaryParts.join("  ·  ") });
      // NOTE: Table caps its rows to MAX_ROWS here; the general truncation below is a no-op.
      break;
    }
    case "Service": {
      const methods = Array.isArray(p.Methods) ? (p.Methods as Array<Record<string, unknown>>) : [];
      for (const m of methods) {
        const params = m.Parameters as unknown[] | undefined;
        rows.push({ kind: "method", name: String(m.MethodName ?? ""), isAsync: Boolean(m.IsAsync), paramCount: params?.length ?? 0 });
      }
      break;
    }
    case "Controller": {
      const eps = Array.isArray(p.Endpoints) ? (p.Endpoints as Array<Record<string, unknown>>) : [];
      for (const ep of eps) {
        rows.push({ kind: "endpoint", method: String(ep.HttpMethod ?? "GET"), path: String(ep.Route ?? "/") });
      }
      break;
    }
    case "DTO": {
      const fields = Array.isArray(p.Fields) ? (p.Fields as Array<Record<string, unknown>>) : [];
      for (const f of fields) {
        rows.push({ kind: "field", name: String(f.Name ?? ""), fieldType: String(f.DataType ?? ""), required: Boolean(f.IsRequired) });
      }
      break;
    }
    case "Model": {
      const props = Array.isArray(p.Properties) ? (p.Properties as Array<Record<string, unknown>>) : [];
      for (const f of props) {
        rows.push({ kind: "field", name: String(f.Name ?? ""), fieldType: String(f.Type ?? ""), required: true });
      }
      break;
    }
    case "Enum": {
      const vals = Array.isArray(p.Values) ? (p.Values as Array<Record<string, unknown>>) : [];
      for (const v of vals) rows.push({ kind: "enum-value", value: String(v.Key ?? "") });
      break;
    }
    case "Repository":
      rows.push({ kind: "kv", label: "entity", value: String(p.EntityReference ?? "") });
      break;
    case "Cache":
      if (p.KeyPattern) rows.push({ kind: "kv", label: "prefix", value: String(p.KeyPattern) });
      if (p.TTL_Seconds !== undefined) rows.push({ kind: "kv", label: "ttl", value: `${p.TTL_Seconds}s` });
      break;
    case "ExternalService": {
      const url = String(p.BaseURL ?? "");
      rows.push({ kind: "kv", label: "url", value: url.length > 22 ? url.slice(0, 22) + "…" : url });
      if (p.AuthType) rows.push({ kind: "kv", label: "auth", value: String(p.AuthType).toLowerCase() });
      break;
    }
    case "MessageQueue":
      rows.push({ kind: "kv", label: "type", value: String(p.Type ?? "").toLowerCase() });
      break;
    case "Worker":
      rows.push({ kind: "kv", label: "schedule", value: String(p.Schedule ?? "") });
      break;
    case "Middleware":
      rows.push({ kind: "kv", label: "order", value: String(p.ExecutionOrder ?? "") });
      break;
    case "EnvironmentVariable":
      rows.push({ kind: "kv", label: "type", value: String(p.DataType ?? "").toLowerCase() });
      break;
    case "Exception":
      rows.push({ kind: "kv", label: "http", value: String(p.HttpStatusCode ?? "") });
      break;
    case "APIGateway":
      rows.push({ kind: "kv", label: "provider", value: String(p.Provider ?? "").toLowerCase() });
      break;
    default:
      break;
  }

  if (rows.length > MAX_ROWS) {
    const extra = rows.length - MAX_ROWS + 1;
    rows.splice(MAX_ROWS - 1, rows.length, { kind: "more", count: extra });
  }
  return rows;
}

/** Node type → header subtitle template. */
function subtitleOf(n: SceneNode): string {
  const p = n.properties ?? {};
  switch (n.type) {
    case "Table": {
      const cols = Array.isArray(p.Columns) ? p.Columns.length : 0;
      return `${cols} columns · table`;
    }
    case "DTO": {
      const fields = Array.isArray(p.Fields) ? p.Fields.length : 0;
      return `${fields} fields · dto`;
    }
    case "Model": {
      const props = Array.isArray(p.Properties) ? p.Properties.length : 0;
      return `${props} props · model`;
    }
    case "Service": {
      const ms = Array.isArray(p.Methods) ? p.Methods.length : 0;
      return `${ms} methods · service`;
    }
    case "Controller": {
      const eps = Array.isArray(p.Endpoints) ? p.Endpoints.length : 0;
      return `${eps} routes · controller`;
    }
    case "Enum": {
      const vs = Array.isArray(p.Values) ? p.Values.length : 0;
      return `${vs} values · enum`;
    }
    case "View":              return "view · readonly";
    case "Repository":        return "repository";
    case "Cache":             return `${String(p.Engine ?? "kv").toLowerCase()} · cache`;
    case "ExternalService":   return "external · http";
    case "MessageQueue":      return `${String(p.Provider ?? "queue").toLowerCase()} · bus`;
    case "Worker":            return "worker · scheduled";
    case "EventHandler":      return "event handler";
    case "Orchestrator":      return `${String(p.Pattern ?? "saga").toLowerCase()} · orchestrator`;
    case "Middleware":        return "middleware";
    case "EnvironmentVariable":return "env · config";
    case "Exception":         return "exception";
    case "APIGateway":        return `${String(p.Provider ?? "gateway").toLowerCase()} · gateway`;
    case "FrontendApp":       return `${String(p.Framework ?? "react").toLowerCase()} · frontend`;
    case "UIComponent":       return "component";
    case "Module":            return "module";
    default: return n.type.toLowerCase();
  }
}

// Path2D cache — parse once per FA icon, then reuse (perf).
const ICON_PATH_CACHE = new Map<string, Path2D>();
function getIconPath(pathData: string | string[]): Path2D {
  const key = Array.isArray(pathData) ? pathData[0] : pathData;
  let p = ICON_PATH_CACHE.get(key);
  if (!p) {
    p = new Path2D(key);
    ICON_PATH_CACHE.set(key, p);
  }
  return p;
}

/** Premium node icon — FontAwesome solid SVG path drawn via Canvas2D Path2D.
 *  cx,cy: icon box center; size: full box edge length (px); color: family color. */
function drawNodeIcon(
  ctx: CanvasRenderingContext2D,
  type: string,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const def = NODE_FA_ICON[type];
  if (!def) return;
  // FA icon: [width, height, ligatures, unicode, pathData]
  const [vw, vh, , , pathData] = def.icon;
  const path = getIconPath(pathData);
  // Icon box 55% fill — proportional scale relative to viewBox
  const target = size * 0.55;
  const scale = target / Math.max(vw, vh);
  const drawW = vw * scale;
  const drawH = vh * scale;

  ctx.save();
  ctx.translate(cx - drawW / 2, cy - drawH / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  // FA paths use evenodd fill rule — for icons with holes (database, shield)
  ctx.fill(path, "evenodd");
  ctx.restore();
}

// typeGlyph and familyChipLabel removed (drawNodeIcon + pill removal).

/** Actual display height of the node (world px). */
export function nodeDisplayH(n: SceneNode): number {
  return HEADER_H + previewRows(n).length * ROW_H;
}

/** Draws the entire scene. `now` is for AI streaming pop/fade animation —
 *  defaults to performance.now() (assumes no animation in test/legacy calls). */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: Scene,
  vp: Viewport,
  selectedId: string | null = null,
  hoveredId: string | null = null,
  edgePath: EdgePathMode = "bezier",
  getBend?: (edgeId: string) => number | undefined,
  hoveredEdgeId: string | null = null,
  selectedEdgeId: string | null = null,
  getBundle?: (edgeId: string) => { src: number; tgt: number } | undefined,
  now: number = performance.now(),
  /** Active spotlight focus set (selected node + 1-hop neighbours + incident edges).
   *  null → no selection → no dimming. */
  focus: FocusSet | null = null,
  /** Dim transition amount 0..1 (0 = no dim, 1 = full dim). Lerps for a short fade. */
  dimAmount: number = 0,
  /** Inline AI proposal: pending (not yet approved) node/edge ids —
   *  drawn with a green highlight. null → no proposal, normal draw. */
  pending: { nodes: Set<string>; edges: Set<string> } | null = null,
  /** Corridor offsets (spreading elbow middle segments side by side) — edgeId → world px. */
  corridors: Map<string, number> | null = null,
  /** Crossing hops — edgeId → hop list (from the CanvasView sig-cache). */
  hops: Map<string, EdgeHop[]> | null = null,
  /** Touch (coarse pointer): with no hover, ports are drawn continuously on ALL settled
   *  nodes (so connection points are discoverable). false → classic hover-only. */
  coarse: boolean = false,
  /** Tap-to-connect: the "armed" source port (nodeId+side) → a distinct accent ring is drawn
   *  (awaiting target selection). null → normal. */
  armedPort: { nodeId: string; side: "in" | "out" } | null = null,
): void {
  refreshPalette(); // refresh theme-aware colors once at frame start
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PAL.paper;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, width, height, vp);

  // Spotlight: out-of-focus alpha = lerp(1, FOCUS_DIM_ALPHA, dimAmount).
  // dimActive guards every per-element check so the no-selection path is unchanged.
  const dimActive = focus !== null && dimAmount > 0.001;
  const dimAlpha = 1 - (1 - FOCUS_DIM_ALPHA) * dimAmount;
  const edgeInFocus = (e: SceneEdge): boolean =>
    !dimActive || !focus || focus.edges.has(e.id);
  const nodeInFocus = (n: SceneNode): boolean =>
    !dimActive || !focus || focus.nodes.has(n.id);

  // Trunk sets — ports with ≥2 in/out share a common body (merge area).
  const { trunkOut, trunkIn } = computeTrunkSets(scene);

  // Edges — AI streaming fade-in (opacity 0→1 when enterStart is set)
  // Labels are NOT drawn with edges — collected in a sink, drawn on a separate layer
  // after all edges (before nodes) → a label is never hidden under a line.
  const labelSink: EdgeLabelItem[] = [];
  for (const e of scene.edges) {
    const a = scene.index.get(e.source);
    const b = scene.index.get(e.target);
    if (!a || !b) continue;
    if (!segmentVisible(a, b, vp, width, height)) continue;
    const eT = edgeEnterT(e, now);
    if (eT === 0) continue; // still in delay, invisible
    const bun = getBundle?.(e.id);
    // Spotlight: an edge is full only if it's incident to the selected node;
    // edges with both ends out of focus (or simply not in the incident set) dim.
    const dimEdge = dimActive && !edgeInFocus(e);
    const wrap = eT < 1 || dimEdge;
    if (wrap) ctx.save();
    if (eT < 1) ctx.globalAlpha *= eT;
    if (dimEdge) ctx.globalAlpha *= dimAlpha;
    const edgeHops = vp.zoom >= HOP_MIN_ZOOM ? (hops?.get(e.id) ?? null) : null;
    drawEdge(ctx, e, a, b, vp, edgePath, getBend?.(e.id), e.id === hoveredEdgeId, e.id === selectedEdgeId, bun?.src ?? 0, bun?.tgt ?? 0, trunkOut.has(e.source), trunkIn.has(e.target), pending?.edges.has(e.id) ?? false, corridors?.get(e.id) ?? 0, edgeHops, labelSink);
    if (wrap) ctx.restore();
  }

  // ── Trunk bodies (merge area) — drawn AFTER branches, on top.
  // At a port shared by ≥2 edges: branches merge at the solder point (24px out from the
  // port), a single distinct body enters the port; on the inbound side a SINGLE shared arrowhead.
  if (trunkOut.size > 0 || trunkIn.size > 0) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineCap = "round";
    const STUB = STUB_LEN_WORLD * vp.zoom;
    const trunkW = Math.max(1.5, 2 * vp.zoom);
    const dotR = Math.max(2, 2.4 * vp.zoom);
    const baseAlpha = ctx.globalAlpha;
    const trunkAlpha = (nid: string) =>
      baseAlpha * (dimActive && focus && !focus.nodes.has(nid) ? dimAlpha : 1);
    for (const nid of trunkOut) {
      const n = scene.index.get(nid)!;
      ctx.globalAlpha = trunkAlpha(nid);
      const pw = portOf(n, "out");
      const ps = { x: sx(pw.x, vp), y: sy(pw.y, vp) };
      ctx.strokeStyle = PAL.inkSoft;
      ctx.lineWidth = trunkW;
      ctx.beginPath();
      ctx.moveTo(ps.x, ps.y);
      ctx.lineTo(ps.x + STUB, ps.y);
      ctx.stroke();
      // Solder point — where the branches split off
      ctx.beginPath();
      ctx.arc(ps.x + STUB, ps.y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = PAL.inkSoft;
      ctx.fill();
    }
    for (const nid of trunkIn) {
      const n = scene.index.get(nid)!;
      ctx.globalAlpha = trunkAlpha(nid);
      const pw = portOf(n, "in");
      const ps = { x: sx(pw.x, vp), y: sy(pw.y, vp) };
      ctx.strokeStyle = PAL.inkSoft;
      ctx.lineWidth = trunkW;
      ctx.beginPath();
      ctx.moveTo(ps.x - STUB, ps.y);
      ctx.lineTo(ps.x, ps.y);
      ctx.stroke();
      // Solder point + single shared arrowhead (so per-edge markers don't overlap)
      ctx.beginPath();
      ctx.arc(ps.x - STUB, ps.y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = PAL.inkSoft;
      ctx.fill();
      drawMarker(ctx, ps, { x: 1, y: 0 }, "filledTri", PAL.inkSoft, vp);
    }
    ctx.restore();
  }

  // ── Edge label layer — overlaps are separated vertically, then drawn in bulk.
  if (labelSink.length > 0) {
    ctx.save();
    ctx.font = "600 10.5px 'Satoshi', system-ui, sans-serif";
    const placed: PlacedLabel[] = labelSink.map((L) => ({
      ...L,
      w: ctx.measureText(L.text.toLowerCase()).width + 10, // matches drawEdgeLabel padX*2
      h: 18,
      dy: 0,
    }));
    resolveLabelOverlaps(placed);
    for (const L of placed) {
      ctx.globalAlpha = L.alpha;
      drawEdgeLabel(ctx, { x: L.x, y: L.y + L.dy }, L.text, L.color);
    }
    ctx.restore();
  }

  // Nodes — AI streaming pop (scale 0.88→1 + opacity 0→1, ease-out-quart 320ms)
  const showText = vp.zoom > 0.38;
  for (const n of scene.nodes) {
    const x = sx(n.x, vp), y = sy(n.y, vp), w = n.w * vp.zoom;
    const dh = nodeDisplayH(n) * vp.zoom;
    if (x + w < -4 || x > width + 4 || y + dh < -4 || y > height + 4) continue;

    const nT = nodeEnterT(n, now);
    const dimNode = dimActive && !nodeInFocus(n);
    const wrap = nT < 1 || dimNode;
    if (wrap) {
      ctx.save();
      if (nT < 1) {
        const cx = x + w / 2;
        const cy = y + dh / 2;
        const s = 0.88 + 0.12 * nT;
        ctx.translate(cx, cy);
        ctx.scale(s, s);
        ctx.translate(-cx, -cy);
        ctx.globalAlpha *= nT;
      }
      if (dimNode) ctx.globalAlpha *= dimAlpha;
    }
    drawNode(ctx, n, x, y, w, dh, showText, n.id === selectedId, n.id === hoveredId);
    // Pending AI proposal — green wash + ring ("proposal" feel until approved).
    if (pending?.nodes.has(n.id)) {
      const r = BORDER_R * (w / n.w);
      ctx.save();
      rr(ctx, x, y, w, dh, r);
      ctx.fillStyle = "rgba(16,185,129,0.10)";
      ctx.fill();
      ctx.strokeStyle = "rgba(16,185,129,0.9)";
      ctx.lineWidth = Math.max(1, 1.4 * vp.zoom);
      ctx.stroke();
      // Outer soft ring
      rr(ctx, x - 3, y - 3, w + 6, dh + 6, r + 3);
      ctx.strokeStyle = "rgba(16,185,129,0.28)";
      ctx.lineWidth = Math.max(2.5, 3.5 * vp.zoom);
      ctx.stroke();
      ctx.restore();
    }
    // Ports: on hover with a mouse; continuously on all settled nodes on touch (coarse).
    // To avoid clutter, ports of non-selected/non-hovered nodes are FAINT on touch.
    if ((n.id === hoveredId || coarse) && nT === 1) {
      const ox = x + w, oy = y + dh / 2;
      const portColor = famColor(colorOfFamily(n.family ?? familyOf(n.type)));
      const faint = coarse && n.id !== hoveredId && n.id !== selectedId;
      if (n.id === hoveredId) {
        // orange halo only on hover (mouse) — to show which port is active
        ctx.save();
        ctx.beginPath();
        ctx.arc(ox, oy, 14, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,138,61,0.15)";
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      if (faint) ctx.globalAlpha *= 0.4;
      drawPort(ctx, ox, oy, portColor);
      drawPort(ctx, x, y + dh / 2, portColor);
      ctx.restore();
    }
    // Tap-to-connect: armed source port → distinct accent ring (awaiting target).
    if (armedPort && armedPort.nodeId === n.id && nT === 1) {
      const px = armedPort.side === "out" ? x + w : x;
      const py = y + dh / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, PORT_R + 5, 0, Math.PI * 2);
      ctx.strokeStyle = "#ff8a3d";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, PORT_R, 0, Math.PI * 2);
      ctx.fillStyle = "#ff8a3d";
      ctx.fill();
      ctx.restore();
    }
    if (wrap) ctx.restore();
  }
}

/** Hops are not drawn below this zoom (visual noise + cost). */
export const HOP_MIN_ZOOM = 0.45;

/** Label layer types — drawEdge pushes to the sink, drawScene separates and draws them. */
interface EdgeLabelItem {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
}
interface PlacedLabel extends EdgeLabelItem {
  w: number;
  h: number;
  dy: number;
}

/** Pushes overlapping label pairs in opposite vertical directions (halfway each, max
 *  ±22px per axis, 3 passes) — the label version of the AABB separator in arrange. */
function resolveLabelOverlaps(items: PlacedLabel[]): void {
  const MAX_SHIFT = 22;
  const PAD = 2;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const A = items[i], B = items[j];
        const ay = A.y + A.dy, by = B.y + B.dy;
        const overlapX = Math.abs(A.x - B.x) < (A.w + B.w) / 2 + PAD;
        const dyAbs = Math.abs(ay - by);
        const needV = (A.h + B.h) / 2 + PAD;
        if (!overlapX || dyAbs >= needV) continue;
        const shift = Math.ceil((needV - dyAbs) / 2);
        const aUp = ay <= by; // upper one goes up, lower one goes down
        const aDelta = aUp ? -shift : shift;
        const bDelta = aUp ? shift : -shift;
        A.dy = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, A.dy + aDelta));
        B.dy = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, B.dy + bDelta));
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** Trunk sets — sources with ≥2 outputs / targets with ≥2 inputs connect to the port
 *  via a shared body (merge area). drawScene and edge-hops derive the same set. */
export function computeTrunkSets(scene: Scene): { trunkOut: Set<string>; trunkIn: Set<string> } {
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const e of scene.edges) {
    if (!scene.index.has(e.source) || !scene.index.has(e.target)) continue;
    outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1);
    inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1);
  }
  const trunkOut = new Set<string>();
  const trunkIn = new Set<string>();
  for (const [id, c] of outCount) if (c >= 2) trunkOut.add(id);
  for (const [id, c] of inCount) if (c >= 2) trunkIn.add(id);
  return { trunkOut, trunkIn };
}

/** Reduces the edge path to a point list in WORLD coordinates — both the crossing
 *  computation (edge-hops) and the hop-aware draw use the same geometry (seg indices
 *  must match exactly). Mirror of drawEdge's draw geometry:
 *  port → stub (starts from the branch solder point if a trunk exists) → drop to bundle offset
 *  → middle path (bezier is flattened, elbow corners rounded in 4 steps each)
 *  → drop → stub → port. */
export function edgePolylineWorld(
  a: SceneNode,
  b: SceneNode,
  mode: EdgePathMode,
  bend: number | undefined,
  srcOffset: number,
  tgtOffset: number,
  corrOff: number,
  hasTrunkOut: boolean,
  hasTrunkIn: boolean,
): { x: number; y: number }[] {
  const portOut = portOf(a, "out");
  const portIn = portOf(b, "in");
  const stubOut = { x: portOut.x + STUB_LEN_WORLD, y: portOut.y };
  const stubIn = { x: portIn.x - STUB_LEN_WORLD, y: portIn.y };
  const srcDx = srcOffset === 0 ? 0 : 12;
  const tgtDx = tgtOffset === 0 ? 0 : 12;

  const start = { x: stubOut.x + srcDx, y: stubOut.y + srcOffset };
  const end = { x: stubIn.x - tgtDx, y: stubIn.y + tgtOffset };

  const pts: { x: number; y: number }[] = [];
  const push = (x: number, y: number) => {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - x) < 0.01 && Math.abs(last.y - y) < 0.01) return;
    pts.push({ x, y });
  };
  // Flatten the quadratic corner in 4 steps (8px corner — no visual difference).
  const quad = (p0: { x: number; y: number }, c: { x: number; y: number }, p1: { x: number; y: number }) => {
    for (let k = 1; k <= 4; k++) {
      const t = k / 4, mt = 1 - t;
      push(mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x, mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y);
    }
  };

  if (!hasTrunkOut) push(portOut.x, portOut.y);
  push(stubOut.x, stubOut.y);
  if (start.y !== stubOut.y) {
    push(start.x, start.y); // Diagonal straight exit
  } else {
    push(start.x, start.y);
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (mode === "bezier") {
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const off = Math.min(Math.max(Math.abs(horiz ? dx : dy) * 0.4, 24), 200);
    const c1 = horiz ? { x: start.x + off, y: start.y } : { x: start.x, y: start.y + off };
    const c2 = horiz ? { x: end.x - off, y: end.y } : { x: end.x, y: end.y - off };
    const N = 24;
    for (let k = 1; k <= N; k++) {
      const t = k / N, mt = 1 - t;
      push(
        mt * mt * mt * start.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * end.x,
        mt * mt * mt * start.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * end.y,
      );
    }
  } else if (mode === "elbow") {
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const ratio = bend ?? 0.5;
    const r = Math.min(8, Math.abs(dx) * Math.min(ratio, 1 - ratio), Math.abs(dy) / 2);
    const sx0 = Math.sign(dx) || 1;
    const sy0 = Math.sign(dy) || 1;
    if (horiz) {
      const mx = start.x + dx * ratio + corrOff;
      push(mx - sx0 * r, start.y);
      quad({ x: mx - sx0 * r, y: start.y }, { x: mx, y: start.y }, { x: mx, y: start.y + sy0 * r });
      push(mx, end.y - sy0 * r);
      quad({ x: mx, y: end.y - sy0 * r }, { x: mx, y: end.y }, { x: mx + sx0 * r, y: end.y });
      push(end.x, end.y);
    } else {
      const my = start.y + dy * ratio + corrOff;
      push(start.x, my - sy0 * r);
      quad({ x: start.x, y: my - sy0 * r }, { x: start.x, y: my }, { x: start.x + sx0 * r, y: my });
      push(end.x - sx0 * r, my);
      quad({ x: end.x - sx0 * r, y: my }, { x: end.x, y: my }, { x: end.x, y: my + sy0 * r });
      push(end.x, end.y);
    }
  } else {
    push(end.x, end.y);
  }

  if (end.y !== stubIn.y) {
    push(stubIn.x, stubIn.y); // Diagonal straight entry
  } else {
    push(stubIn.x, stubIn.y);
  }
  if (!hasTrunkIn) push(portIn.x, portIn.y);
  return pts;
}

/** Draws the polyline with hops (crossing jumps) — the path is cut at the hop point,
 *  a small semicircle jumps "over" it (circuit-diagram aesthetic). The dash pattern
 *  flows naturally along the path (single path + single stroke). */
function strokePolylineWithHops(
  ctx: CanvasRenderingContext2D,
  ptsW: { x: number; y: number }[],
  hops: EdgeHop[],
  vp: Viewport,
): void {
  if (ptsW.length < 2) return;
  const r = Math.min(8, Math.max(4, 5 * vp.zoom));
  ctx.beginPath();
  ctx.moveTo(sx(ptsW[0].x, vp), sy(ptsW[0].y, vp));
  for (let i = 0; i < ptsW.length - 1; i++) {
    const p0 = { x: sx(ptsW[i].x, vp), y: sy(ptsW[i].y, vp) };
    const p1 = { x: sx(ptsW[i + 1].x, vp), y: sy(ptsW[i + 1].y, vp) };
    const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (segLen < 0.5) { ctx.lineTo(p1.x, p1.y); continue; }
    const dir = { x: (p1.x - p0.x) / segLen, y: (p1.y - p0.y) / segLen };
    const theta = Math.atan2(dir.y, dir.x);
    let lastEndT = 0; // prevent hops from overlapping on the segment
    for (const h of hops) {
      if (h.seg !== i) continue;
      const hp = { x: sx(h.x, vp), y: sy(h.y, vp) };
      const dAlong = (hp.x - p0.x) * dir.x + (hp.y - p0.y) * dir.y;
      // Skip (draw straight) a hop that doesn't fit the segment ends or overlaps the previous hop.
      if (dAlong - r < lastEndT + 1 || dAlong + r > segLen - 1) continue;
      ctx.lineTo(hp.x - dir.x * r, hp.y - dir.y * r);
      // Semicircle — bulges toward the "left" of the travel direction (up when horizontal).
      ctx.arc(hp.x, hp.y, r, theta + Math.PI, theta, false);
      lastEndT = dAlong + r;
    }
    ctx.lineTo(p1.x, p1.y);
  }
  ctx.stroke();
}

/** Connection port. */
export const PORT_R = 6; // react-flow style delicate port (slightly larger for hover selectability)
export const STUB_LEN_WORLD = 24;

export function portOf(n: SceneNode, side: "in" | "out"): { x: number; y: number } {
  const dh = nodeDisplayH(n);
  return side === "out"
    ? { x: n.x + n.w, y: n.y + dh / 2 }
    : { x: n.x, y: n.y + dh / 2 };
}

/** Passive port: white fill + family color border + small family center dot.
 *  Minimal/react-flow style, doesn't stand out among many nodes. Active drag rubber-band
 *  is still bright orange (in drawPendingEdge) — user's active action stays prominent. */
function drawPort(ctx: CanvasRenderingContext2D, px: number, py: number, color: string = "#94a3b8"): void {
  ctx.save();
  // White fill + family color border (subtle contact shadow — "lifted" feel above the card)
  ctx.beginPath();
  ctx.arc(px, py, PORT_R, 0, Math.PI * 2);
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.shadowColor = "rgba(11,16,32,0.18)";
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Center dot — family color
  ctx.beginPath();
  ctx.arc(px, py, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

export const BEND_HANDLE_R = 6;
function drawBendHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, BEND_HANDLE_R, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fill();
  ctx.strokeStyle = "#ff8a3d";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

export function elbowGeom(a: SceneNode, b: SceneNode, bend: number = 0.5):
  | { handle: { x: number; y: number }; horiz: boolean; start: { x: number; y: number }; end: { x: number; y: number } }
  | null
{
  const portOutW = portOf(a, "out");
  const portInW = portOf(b, "in");
  const startW = { x: portOutW.x + STUB_LEN_WORLD, y: portOutW.y };
  const endW = { x: portInW.x - STUB_LEN_WORLD, y: portInW.y };
  const dx = endW.x - startW.x;
  const dy = endW.y - startW.y;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return null;
  const horiz = Math.abs(dx) >= Math.abs(dy);
  const handle = horiz
    ? { x: startW.x + dx * bend, y: (startW.y + endW.y) / 2 }
    : { x: (startW.x + endW.x) / 2, y: startW.y + dy * bend };
  return { handle, horiz, start: startW, end: endW };
}

export function drawPendingEdge(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  ctx.save();
  ctx.strokeStyle = "#ff8a3d";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(to.x, to.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#ff8a3d";
  ctx.fill();
  ctx.restore();
}

/** Dot grid (Figma/Linear style) — intersection dots instead of lines.
 *  The fine set fades gradually with zoom (no hard cutoff); the 5x sparse set keeps a
 *  sense of structure from afar. Dots are a fixed size in screen space (crisp). */
function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, vp: Viewport): void {
  const step = GRID_SIZE * vp.zoom;
  const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const drawDots = (spacing: number, alpha: number, r: number) => {
    if (alpha <= 0.01 || spacing < 4) return;
    ctx.fillStyle = `rgba(${PAL.gridRgb}, ${alpha})`;
    const ox = ((vp.x % spacing) + spacing) % spacing;
    const oy = ((vp.y % spacing) + spacing) % spacing;
    const d = r * 2;
    ctx.beginPath();
    for (let x = ox; x < width; x += spacing) {
      for (let y = oy; y < height; y += spacing) {
        ctx.rect(x - r, y - r, d, d);
      }
    }
    ctx.fill();
  };
  // dots are LIGHT on dark (pure black ground) → dim the alpha so they aren't "too visible".
  const ga = PAL.dark ? 0.5 : 1;
  // Fine set: fades softly below 16px spacing (fully gone at 8px).
  drawDots(step, 0.18 * ga * clamp01((step - 8) / 8), 1.1);
  // Sparse set (5x): conveys the diagram's scale even when the fine set is gone.
  const step5 = step * 5;
  if (step5 < 2400) drawDots(step5, 0.26 * ga * clamp01((step5 - 14) / 20), 1.4);
}

// ── Edge halo (selection / hover underlay) ──────────────────────
/** Re-draws the edge path geometry as-is — caller sets stroke style/width/dash.
 *  Identical path geometry to drawEdge (stub-out + middle bezier/elbow/straight
 *  + stub-in) but geometry only. */
function drawEdgeHaloPath(
  ctx: CanvasRenderingContext2D,
  mode: EdgePathMode,
  portOut: { x: number; y: number },
  portIn: { x: number; y: number },
  stubOut: { x: number; y: number },
  stubIn: { x: number; y: number },
  stubOutShifted: { x: number; y: number },
  stubInShifted: { x: number; y: number },
  hasTrunkOut: boolean,
  hasTrunkIn: boolean,
  bend: number | undefined,
  start: { x: number; y: number },
  end: { x: number; y: number },
  vp: Viewport,
  /** Corridor offset (screen px) — so the elbow middle-segment shift matches the main draw. */
  corrS: number = 0,
): void {
  ctx.beginPath();
  if (hasTrunkOut) {
    ctx.moveTo(stubOut.x, stubOut.y);
    if (stubOutShifted.y !== stubOut.y) {
      ctx.lineTo(stubOutShifted.x, stubOutShifted.y); // Diagonal straight exit
    }
  } else {
    ctx.moveTo(portOut.x, portOut.y);
    ctx.lineTo(stubOut.x, stubOut.y);
    if (stubOutShifted.y !== stubOut.y) {
      ctx.lineTo(stubOutShifted.x, stubOutShifted.y);
    }
  }

  // Middle path
  if (mode === "bezier") {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const off = Math.min(Math.max(Math.abs(horiz ? dx : dy) / vp.zoom * 0.4, 24), 200) * vp.zoom;
    const c1 = horiz ? { x: start.x + off, y: start.y } : { x: start.x, y: start.y + off };
    const c2 = horiz ? { x: end.x - off, y: end.y } : { x: end.x, y: end.y - off };
    ctx.lineTo(start.x, start.y);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
  } else if (mode === "elbow") {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const sx0 = Math.sign(dx) || 1;
    const sy0 = Math.sign(dy) || 1;
    const ratio = bend ?? 0.5;
    const r = Math.min(8 * vp.zoom, Math.abs(dx) * Math.min(ratio, 1 - ratio), Math.abs(dy) / 2);
    ctx.lineTo(start.x, start.y);
    if (horiz) {
      const mx = start.x + dx * ratio + corrS;
      ctx.lineTo(mx - sx0 * r, start.y);
      ctx.quadraticCurveTo(mx, start.y, mx, start.y + sy0 * r);
      ctx.lineTo(mx, end.y - sy0 * r);
      ctx.quadraticCurveTo(mx, end.y, mx + sx0 * r, end.y);
      ctx.lineTo(end.x, end.y);
    } else {
      const my = start.y + dy * ratio + corrS;
      ctx.lineTo(start.x, my - sy0 * r);
      ctx.quadraticCurveTo(start.x, my, start.x + sx0 * r, my);
      ctx.lineTo(end.x - sx0 * r, my);
      ctx.quadraticCurveTo(end.x, my, end.x, my + sy0 * r);
      ctx.lineTo(end.x, end.y);
    }
  } else {
    ctx.lineTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  }

  // Stub-in
  ctx.lineTo(stubInShifted.x, stubInShifted.y);
  if (stubIn.y !== stubInShifted.y) {
    // Allow a soft curve (rotate)
    ctx.quadraticCurveTo(stubIn.x, stubInShifted.y, stubIn.x, stubIn.y);
  }
  if (!hasTrunkIn) ctx.lineTo(portIn.x, portIn.y);
  ctx.stroke();
}

function drawEdge(
  ctx: CanvasRenderingContext2D,
  e: SceneEdge,
  a: SceneNode,
  b: SceneNode,
  vp: Viewport,
  mode: EdgePathMode,
  bend?: number,
  isHovered: boolean = false,
  isSelected: boolean = false,
  srcOffset: number = 0,
  tgtOffset: number = 0,
  /** Whether the source/target port has a trunk (merge body) — the branch ends at the solder
   *  point, the final 24px body + shared arrowhead are drawn in drawScene's trunk pass. */
  hasTrunkOut: boolean = false,
  hasTrunkIn: boolean = false,
  /** Pending AI proposal — green underlay halo (same geometry as the selection halo). */
  isPending: boolean = false,
  /** Corridor offset (world px) — shifts the elbow middle segment on the perpendicular axis. */
  corrOff: number = 0,
  /** This edge's crossing hops — if present, drawn with hops along the path polyline. */
  hops: EdgeHop[] | null = null,
  /** Labels are collected here; drawScene draws them on a separate layer. */
  labelSink: { x: number; y: number; text: string; color: string; alpha: number }[] | null = null,
): void {
  const portOutW = portOf(a, "out");
  const portInW = portOf(b, "in");
  const portOut = { x: sx(portOutW.x, vp), y: sy(portOutW.y, vp) };
  const portIn = { x: sx(portInW.x, vp), y: sy(portInW.y, vp) };

  const STUB = STUB_LEN_WORLD * vp.zoom;
  const stubOut = { x: portOut.x + STUB, y: portOut.y };
  const stubIn = { x: portIn.x - STUB, y: portIn.y };

  // Bundle offsets for a softer merge (trunk).
  // Previously shifted only on the Y axis (stubInShifted.x = stubIn.x), which created a
  // perpendicular (90-degree) collision at the trunk point and overflowed due to lineCap.
  // Now we also add a slight spread on the X axis to open room for the curve (rotate).
  const srcDx = srcOffset === 0 ? 0 : 12 * vp.zoom;
  const tgtDx = tgtOffset === 0 ? 0 : 12 * vp.zoom;
  
  const stubOutShifted = { x: stubOut.x + srcDx, y: stubOut.y + srcOffset * vp.zoom };
  const stubInShifted = { x: stubIn.x - tgtDx, y: stubIn.y + tgtOffset * vp.zoom };

  const start = stubOutShifted;
  const end = stubInShifted;

  // Corridor offset is converted to screen pixels (geometry is defined in world space).
  const corrS = corrOff * vp.zoom;

  // Elbow bend handle — same point in both normal and hop-aware drawing.
  let elbowHandle: { x: number; y: number } | null = null;
  if (mode === "elbow") {
    const hdx = end.x - start.x;
    const hdy = end.y - start.y;
    const hHoriz = Math.abs(hdx) >= Math.abs(hdy);
    const hRatio = bend ?? 0.5;
    elbowHandle = hHoriz
      ? { x: start.x + hdx * hRatio + corrS, y: (start.y + end.y) / 2 }
      : { x: (start.x + end.x) / 2, y: start.y + hdy * hRatio + corrS };
  }

  const style = getEdgeStyle(e.kind, e.isAsync);
  const w = Math.max(0.6, style.width * vp.zoom);

  // ── Selection / Hover halo (UNDER edge stroke, brand accent) ────
  // Senior UX: edge's own personality (color/dash/width conveys edge type)
  // is preserved. Selection feedback is on a separate layer — refined orange underlay.
  if (isSelected || isHovered || isPending) {
    ctx.save();
    // Priority: pending (green proposal) > selected > hover.
    ctx.strokeStyle = isPending
      ? "rgba(16, 185, 129, 0.30)"
      : isSelected
        ? "rgba(255, 138, 61, 0.20)"
        : "rgba(255, 138, 61, 0.08)";
    ctx.lineWidth = isSelected || isPending
      ? Math.max(7, 4.5 * vp.zoom)
      : Math.max(4, 3 * vp.zoom);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([]);
    drawEdgeHaloPath(ctx, mode, portOut, portIn, stubOut, stubIn,
      stubOutShifted, stubInShifted, hasTrunkOut, hasTrunkIn, bend, start, end, vp, corrS);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = edgeColor(style.color);
  ctx.lineWidth = w;
  ctx.setLineDash(style.dash);
  ctx.lineCap = "round";  // soft start/end — Linear/Figma standard
  ctx.lineJoin = "round";

  if (hops && hops.length > 0) {
    // Hop-aware draw — the whole path (including stubs) as a single polyline + hop arcs.
    // The polyline comes from edgePolylineWorld; the hops' seg indices are relative to it.
    const ptsW = edgePolylineWorld(a, b, mode, bend, srcOffset, tgtOffset, corrOff, hasTrunkOut, hasTrunkIn);
    strokePolylineWithHops(ctx, ptsW, hops, vp);
  } else {
    ctx.beginPath();
    if (hasTrunkOut) {
      // Starts from the branch solder point — the trunk pass draws the port→stub body.
      ctx.moveTo(stubOut.x, stubOut.y);
      if (stubOutShifted.y !== stubOut.y) ctx.lineTo(stubOutShifted.x, stubOutShifted.y);
    } else {
      ctx.moveTo(portOut.x, portOut.y);
      ctx.lineTo(stubOut.x, stubOut.y);
      if (stubOutShifted.y !== stubOut.y) ctx.lineTo(stubOutShifted.x, stubOutShifted.y);
    }

    if (mode === "bezier") {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const horiz = Math.abs(dx) >= Math.abs(dy);
      // Control offset is world-based (clamp world px) → the curve shape is zoom-independent,
      // exactly the same geometry as the polyline (crossing computation).
      const off = Math.min(Math.max(Math.abs(horiz ? dx : dy) / vp.zoom * 0.4, 24), 200) * vp.zoom;
      const c1 = horiz ? { x: start.x + off, y: start.y } : { x: start.x, y: start.y + off };
      const c2 = horiz ? { x: end.x - off, y: end.y } : { x: end.x, y: end.y - off };
      ctx.lineTo(start.x, start.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
    } else if (mode === "elbow") {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const horiz = Math.abs(dx) >= Math.abs(dy);
      const sx0 = Math.sign(dx) || 1;
      const sy0 = Math.sign(dy) || 1;
      const ratio = bend ?? 0.5;
      const r = Math.min(8 * vp.zoom, Math.abs(dx) * Math.min(ratio, 1 - ratio), Math.abs(dy) / 2);
      ctx.lineTo(start.x, start.y);
      if (horiz) {
        const mx = start.x + dx * ratio + corrS;
        ctx.lineTo(mx - sx0 * r, start.y);
        ctx.quadraticCurveTo(mx, start.y, mx, start.y + sy0 * r);
        ctx.lineTo(mx, end.y - sy0 * r);
        ctx.quadraticCurveTo(mx, end.y, mx + sx0 * r, end.y);
        ctx.lineTo(end.x, end.y);
      } else {
        const my = start.y + dy * ratio + corrS;
        ctx.lineTo(start.x, my - sy0 * r);
        ctx.quadraticCurveTo(start.x, my, start.x + sx0 * r, my);
        ctx.lineTo(end.x - sx0 * r, my);
        ctx.quadraticCurveTo(end.x, my, end.x, my + sy0 * r);
        ctx.lineTo(end.x, end.y);
      }
    } else {
      ctx.lineTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
    }

    ctx.lineTo(stubInShifted.x, stubInShifted.y);
    if (stubIn.y !== stubInShifted.y) ctx.lineTo(stubIn.x, stubIn.y);
    if (!hasTrunkIn) ctx.lineTo(portIn.x, portIn.y);
    ctx.stroke();
  }

  // Bend handle — on hover/selection, same place in both hop-aware and normal drawing.
  if (elbowHandle && (isHovered || isSelected)) {
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    drawBendHandle(ctx, elbowHandle.x, elbowHandle.y);
    ctx.restore();
  }

  ctx.setLineDash([]);
  // On trunk-in the shared arrowhead is drawn in the trunk pass — so per-edge markers don't overlap.
  if (!hasTrunkIn) drawMarker(ctx, portIn, { x: 1, y: 0 }, style.marker, edgeColor(style.color), vp);

  // Label position — in elbow mode should move with the bend handle.
  // For bezier/straight the path is symmetric, geometric midpoint suffices.
  // Drawing is delegated to drawScene's label layer (sink) — overlaps are separated there.
  const labelText = e.label ?? e.kind;
  if (labelText && vp.zoom >= LABEL_MIN_ZOOM && labelSink) {
    let lx: number, ly: number;
    if (mode === "elbow" && elbowHandle) {
      lx = elbowHandle.x;
      ly = elbowHandle.y;
    } else {
      lx = (start.x + end.x) / 2;
      ly = (start.y + end.y) / 2;
    }
    labelSink.push({ x: lx, y: ly, text: labelText, color: edgeColor(style.color), alpha: ctx.globalAlpha });
  }
  ctx.restore();
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  end: { x: number; y: number },
  t: { x: number; y: number },
  kind: MarkerKind,
  color: string,
  vp: Viewport,
): void {
  const z = vp.zoom;
  // Marker size 8→7 — more balanced, doesn't overwhelm the edge (Linear/Vercel proportion)
  const s = 7 * z;
  const half = 3.5 * z;
  const d = 4 * z;
  const back = (k: number) => ({ x: end.x - t.x * k, y: end.y - t.y * k });
  const perp = { x: -t.y, y: t.x };

  ctx.lineWidth = Math.max(1, 1.15 * z);
  ctx.lineJoin = "round";

  switch (kind) {
    case "filledTri": {
      const tail = back(s);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(tail.x + perp.x * half, tail.y + perp.y * half);
      ctx.lineTo(tail.x - perp.x * half, tail.y - perp.y * half);
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      break;
    }
    case "openTri": {
      const tail = back(s);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(tail.x + perp.x * half, tail.y + perp.y * half);
      ctx.lineTo(tail.x - perp.x * half, tail.y - perp.y * half);
      ctx.closePath();
      ctx.fillStyle = PAL.card; ctx.fill();
      ctx.strokeStyle = color; ctx.stroke();
      break;
    }
    case "filledDiamond": {
      const tail = back(s * 1.4);
      const tip = back(0);
      const back2 = back(s * 0.7);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(back2.x + perp.x * half, back2.y + perp.y * half);
      ctx.lineTo(tail.x, tail.y);
      ctx.lineTo(back2.x - perp.x * half, back2.y - perp.y * half);
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      break;
    }
    case "openCircle": {
      const c = back(d);
      ctx.beginPath();
      ctx.arc(c.x, c.y, d, 0, Math.PI * 2);
      ctx.fillStyle = PAL.card; ctx.fill();
      ctx.strokeStyle = color; ctx.stroke();
      break;
    }
    case "filledDot": {
      const c = back(d);
      ctx.beginPath();
      ctx.arc(c.x, c.y, d, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      break;
    }
    case "doubleTri": {
      const tail1 = back(s);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(tail1.x + perp.x * half, tail1.y + perp.y * half);
      ctx.lineTo(tail1.x - perp.x * half, tail1.y - perp.y * half);
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      const off = s * 0.7;
      const tip2 = back(off);
      const tail2 = back(off + s);
      ctx.beginPath();
      ctx.moveTo(tip2.x, tip2.y);
      ctx.lineTo(tail2.x + perp.x * half, tail2.y + perp.y * half);
      ctx.lineTo(tail2.x - perp.x * half, tail2.y - perp.y * half);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "bar": {
      const c = back(s * 0.4);
      const len = half * 1.6;
      ctx.beginPath();
      ctx.moveTo(c.x + perp.x * len, c.y + perp.y * len);
      ctx.lineTo(c.x - perp.x * len, c.y - perp.y * len);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, 1.8 * z);
      ctx.stroke();
      break;
    }
    case "crowOne": {
      const c = back(s * 0.55);
      const len = half * 1.6;
      ctx.beginPath();
      ctx.moveTo(c.x + perp.x * len, c.y + perp.y * len);
      ctx.lineTo(c.x - perp.x * len, c.y - perp.y * len);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, 1.8 * z);
      ctx.stroke();
      break;
    }
    case "crowMany": {
      const len = s;
      const spread = 0.55;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2, 1.5 * z);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - t.x * len, end.y - t.y * len);
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - t.x * len + perp.x * len * spread, end.y - t.y * len + perp.y * len * spread);
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - t.x * len - perp.x * len * spread, end.y - t.y * len - perp.y * len * spread);
      ctx.stroke();
      break;
    }
    case "crowZeroOne": {
      const cBar = back(s * 0.35);
      const cDot = back(s * 0.9);
      const len = half * 1.5;
      const dR = 3.5 * z;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2, 1.5 * z);
      ctx.beginPath();
      ctx.moveTo(cBar.x + perp.x * len, cBar.y + perp.y * len);
      ctx.lineTo(cBar.x - perp.x * len, cBar.y - perp.y * len);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cDot.x, cDot.y, dR, 0, Math.PI * 2);
      ctx.fillStyle = PAL.card; ctx.fill();
      ctx.stroke();
      break;
    }
    case "crowOneMany": {
      const cBar = back(s * 0.35);
      const lenBar = half * 1.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2, 1.5 * z);
      ctx.beginPath();
      ctx.moveTo(cBar.x + perp.x * lenBar, cBar.y + perp.y * lenBar);
      ctx.lineTo(cBar.x - perp.x * lenBar, cBar.y - perp.y * lenBar);
      ctx.stroke();
      const hub = back(s * 0.85);
      const legLen = s * 0.7;
      const spread = 0.55;
      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(hub.x - t.x * legLen, hub.y - t.y * legLen);
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(hub.x - t.x * legLen + perp.x * legLen * spread, hub.y - t.y * legLen + perp.y * legLen * spread);
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(hub.x - t.x * legLen - perp.x * legLen * spread, hub.y - t.y * legLen - perp.y * legLen * spread);
      ctx.stroke();
      break;
    }
  }
}

/** Edge label at midpoint — NO pill, transparent ground. Excalidraw technique:
 *  the edge line is "cut" by painting PAL.paper over the area the text covers (exactly the
 *  ground color — no card/box feel), then only the edge-colored text is drawn on top. The
 *  line is invisible where the text sits, and the text floats on the paper. */
function drawEdgeLabel(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  text: string,
  color: string,
): void {
  ctx.save();
  ctx.font = "600 10.5px 'Satoshi', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lower = text.toLowerCase();
  const tw = ctx.measureText(lower).width;
  const padX = 5, padY = 2;
  const rectW = tw + padX * 2;
  const rectH = 14 + padY * 2;
  const rectX = pos.x - rectW / 2;
  const rectY = pos.y - rectH / 2;

  // Cut the line: fill the area with the ground color (clearRect + PAL.paper — deterministic;
  // grid dots are erased too, so the text sits on clean paper).
  ctx.clearRect(rectX, rectY, rectW, rectH);
  ctx.fillStyle = PAL.paper;
  ctx.fillRect(rectX, rectY, rectW, rectH);

  // Text only — saturated edge color, no box/border.
  ctx.fillStyle = color;
  ctx.fillText(lower, pos.x, pos.y + 0.5);
  ctx.restore();
}

// ── Node rendering ───────────────────────────────────────────────
// drawFamilyChip and familyChipLabel removed — top-right DATA/BIZ/API pill
// created visual noise. Type info is already conveyed by left accent strip +
// icon + subtitle. Title now uses 2x wider area.

/** Amber key icon — for PK columns. */
function drawKeyGlyph(ctx: CanvasRenderingContext2D, x: number, midY: number, zoom: number): void {
  ctx.save();
  ctx.fillStyle = "#D97706";
  const s = zoom;
  // Ring (key head)
  ctx.beginPath();
  ctx.arc(x + 3 * s, midY, 2.4 * s, 0, Math.PI * 2);
  ctx.fill();
  // Inner hole (cut out)
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(x + 3 * s, midY, 1.0 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  // Shaft
  ctx.fillStyle = "#D97706";
  ctx.fillRect(x + 5.4 * s, midY - 0.7 * s, 4 * s, 1.4 * s);
  // Tooth
  ctx.fillRect(x + 8 * s, midY + 0.7 * s, 1.4 * s, 1.8 * s);
  ctx.restore();
}

/** Orange link icon — for FK columns. */
function drawLinkGlyph(ctx: CanvasRenderingContext2D, x: number, midY: number, zoom: number): void {
  ctx.save();
  ctx.strokeStyle = "#FF8A3D";
  ctx.lineWidth = 1.3 * zoom;
  ctx.lineCap = "round";
  const s = zoom;
  // Left half-ring
  ctx.beginPath();
  ctx.arc(x + 3 * s, midY, 2 * s, Math.PI * 0.5, Math.PI * 1.5);
  ctx.stroke();
  // Right half-ring
  ctx.beginPath();
  ctx.arc(x + 7 * s, midY, 2 * s, Math.PI * 1.5, Math.PI * 0.5);
  ctx.stroke();
  // Middle bar
  ctx.beginPath();
  ctx.moveTo(x + 3 * s, midY);
  ctx.lineTo(x + 7 * s, midY);
  ctx.stroke();
  ctx.restore();
}

interface BadgeStyle { bg: string; border: string | null; text: string; }
// Low saturation: 8% wash bg + 25% border + rich dark text. Prevents
// "Christmas tree" effect; metadata rows stay calm and premium.
const COL_BADGES: Record<string, BadgeStyle> = {
  PK: { bg: "rgba(217, 119, 6, 0.08)",   border: "rgba(217, 119, 6, 0.25)",   text: "#92400E" },  // amber
  FK: { bg: "rgba(37, 99, 235, 0.08)",   border: "rgba(37, 99, 235, 0.25)",   text: "#1E40AF" },  // blue
  NN: { bg: "rgba(100, 116, 139, 0.08)", border: "rgba(100, 116, 139, 0.25)", text: "#475569" },  // slate
  UQ: { bg: "rgba(124, 58, 237, 0.08)",  border: "rgba(124, 58, 237, 0.25)",  text: "#5B21B6" },  // violet
};

const HTTP_BADGES: Record<string, BadgeStyle> = {
  GET:    { bg: "rgba(37, 99, 235, 0.08)",   border: "rgba(37, 99, 235, 0.25)",   text: "#1E40AF" },
  POST:   { bg: "rgba(16, 185, 129, 0.08)",  border: "rgba(16, 185, 129, 0.25)",  text: "#065F46" },
  PUT:    { bg: "rgba(249, 115, 22, 0.08)",  border: "rgba(249, 115, 22, 0.25)",  text: "#9A3412" },
  PATCH:  { bg: "rgba(139, 92, 246, 0.08)",  border: "rgba(139, 92, 246, 0.25)",  text: "#5B21B6" },
  DELETE: { bg: "rgba(220, 38, 38, 0.08)",   border: "rgba(220, 38, 38, 0.25)",   text: "#991B1B" },
};

/** Small badge — h-3.5 (~14px) badge. */
function drawTagBadge(
  ctx: CanvasRenderingContext2D,
  x: number, midY: number,
  text: string, style: BadgeStyle, zoom: number,
): number {
  ctx.font = `700 ${9.5 * zoom}px 'JetBrains Mono', monospace`;
  const tw = ctx.measureText(text).width;
  const padX = 4 * zoom;
  const bw = tw + padX * 2;
  const bh = 14 * zoom;
  rr(ctx, x, midY - bh / 2, bw, bh, 3 * zoom);
  ctx.fillStyle = style.bg; ctx.fill();
  if (style.border) {
    ctx.strokeStyle = style.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = style.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + bw / 2, midY + 0.5 * zoom);
  return bw;
}

function drawContentRows(
  ctx: CanvasRenderingContext2D,
  n: SceneNode,
  x: number,
  bodyY: number,
  w: number,
  zoom: number,
): void {
  const rows = previewRows(n);
  if (rows.length === 0) return;

  const rowHpx = ROW_H * zoom;

  for (let i = 0; i < rows.length; i++) {
    const rowTop = bodyY + i * rowHpx;
    const rowMid = rowTop + rowHpx / 2;
    const row = rows[i];

    // Row divider (between rows only)
    if (i > 0) {
      ctx.strokeStyle = PAL.rowDivider;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 1, rowTop + 0.5);
      ctx.lineTo(x + w - 1, rowTop + 0.5);
      ctx.stroke();
    }

    const padL = x + 12 * zoom; // text breathing room
    const padR = x + w - 12 * zoom;

    ctx.save();
    ctx.textBaseline = "middle";

    switch (row.kind) {
      case "column": {
        // Layout: [icon 12px] [name flex-1] [type uppercase 10px] [NN] [UQ]
        // Right-to-left: badges first, then type
        let rightX = padR;
        const gap = 3 * zoom;

        // Badges (rightmost): only NN, UQ, FK (PK shown as left icon)
        const visibleBadges = row.tags.filter((t) => t === "NN" || t === "UQ" || t === "FK");
        for (const tag of [...visibleBadges].reverse()) {
          const st = COL_BADGES[tag];
          if (!st) continue;
          ctx.font = `700 ${9.5 * zoom}px 'JetBrains Mono', monospace`;
          const tw = ctx.measureText(tag).width + 8 * zoom;
          rightX -= tw + gap;
          drawTagBadge(ctx, rightX, rowMid, tag, st, zoom);
        }

        // Type (right of name)
        if (row.colType) {
          ctx.font = `400 ${11 * zoom}px 'JetBrains Mono', monospace`;
          ctx.fillStyle = PAL.inkFaint;
          ctx.textAlign = "right";
          const typeText = row.colType.toUpperCase();
          ctx.fillText(typeText, rightX - 4 * zoom, rowMid);
          const tw = ctx.measureText(typeText).width;
          rightX -= tw + 8 * zoom;
        }

        // Icon (left): key / link / dot
        const iconX = padL;
        if (row.tags.includes("PK")) {
          drawKeyGlyph(ctx, iconX, rowMid, zoom);
        } else if (row.tags.includes("FK")) {
          drawLinkGlyph(ctx, iconX, rowMid, zoom);
        } else {
          ctx.beginPath();
          ctx.arc(iconX + 4 * zoom, rowMid, 1.2 * zoom, 0, Math.PI * 2);
          ctx.fillStyle = PAL.inkFaint;
          ctx.fill();
        }

        // Name (between icon and rightX)
        const nameX = iconX + 14 * zoom;
        const maxNameW = Math.max(0, rightX - nameX);
        ctx.font = `400 ${12.5 * zoom}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = PAL.ink90;
        ctx.textAlign = "left";
        ctx.fillText(clip(ctx, row.name, maxNameW), nameX, rowMid);
        break;
      }

      case "method": {
        let xCur = padL;
        if (row.isAsync) {
          const bw = drawTagBadge(ctx, xCur, rowMid, "async",
            { bg: "#DBEAFE", border: "#BFDBFE", text: "#1E40AF" }, zoom);
          xCur += bw + 6 * zoom;
        } else {
          // Sync icon: 3 small horizontal lines (matches web_old)
          ctx.strokeStyle = "#10B981";
          ctx.lineWidth = 1.2 * zoom;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(xCur, rowMid - 2.8 * zoom);
          ctx.lineTo(xCur + 6 * zoom, rowMid - 2.8 * zoom);
          ctx.moveTo(xCur, rowMid);
          ctx.lineTo(xCur + 8 * zoom, rowMid);
          ctx.moveTo(xCur, rowMid + 2.8 * zoom);
          ctx.lineTo(xCur + 5 * zoom, rowMid + 2.8 * zoom);
          ctx.stroke();
          xCur += 12 * zoom;
        }

        // Param count on right
        ctx.font = `400 ${11 * zoom}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = PAL.inkFaint;
        ctx.textAlign = "right";
        const pcText = `(${row.paramCount})`;
        ctx.fillText(pcText, padR, rowMid);
        const pcW = ctx.measureText(pcText).width;

        // Name (between async badge/icon and param count)
        ctx.font = `400 ${12.5 * zoom}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = PAL.ink85;
        ctx.textAlign = "left";
        const maxW = Math.max(0, padR - pcW - 8 * zoom - xCur);
        ctx.fillText(clip(ctx, row.name, maxW), xCur, rowMid);
        break;
      }

      case "endpoint": {
        const st = HTTP_BADGES[row.method] ?? { bg: "#F1F5F9", border: null, text: "#64748B" };
        ctx.font = `700 ${10.5 * zoom}px 'JetBrains Mono', monospace`;
        const tw = ctx.measureText(row.method).width;
        const bw = tw + 10 * zoom;
        const bh = 16 * zoom;
        rr(ctx, padL, rowMid - bh / 2, bw, bh, 4 * zoom);
        ctx.fillStyle = st.bg; ctx.fill();
        ctx.fillStyle = st.text;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(row.method, padL + bw / 2, rowMid + 0.5 * zoom);

        // Path
        ctx.font = `400 ${12.5 * zoom}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = PAL.ink85;
        ctx.textAlign = "left";
        const pathX = padL + bw + 8 * zoom;
        ctx.fillText(clip(ctx, row.path, Math.max(0, padR - pathX)), pathX, rowMid);
        break;
      }

      case "field": {
        // Name (left, with optional ?)
        ctx.font = `400 ${12.5 * zoom}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = PAL.ink85;
        ctx.textAlign = "left";
        const name = row.required ? row.name : row.name + "?";
        const nameW = ctx.measureText(name).width;
        ctx.fillText(name, padL, rowMid);

        // Type (right)
        ctx.font = `400 ${11 * zoom}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = PAL.inkFaint;
        ctx.textAlign = "right";
        const maxTypeW = padR - (padL + nameW + 8 * zoom);
        const typeText = row.fieldType.toUpperCase();
        if (maxTypeW > 0) {
          ctx.fillText(clip(ctx, typeText, maxTypeW), padR, rowMid);
        }
        break;
      }

      case "enum-value": {
        ctx.font = `500 ${12 * zoom}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = PAL.ink85;
        ctx.textAlign = "left";
        ctx.fillText(row.value, padL, rowMid);
        break;
      }

      case "kv": {
        ctx.font = `400 ${11.5 * zoom}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = PAL.inkFaint;
        ctx.textAlign = "left";
        ctx.fillText(row.label, padL, rowMid);

        ctx.fillStyle = PAL.ink85;
        ctx.textAlign = "right";
        ctx.fillText(clip(ctx, row.value, padR - padL - 60 * zoom), padR, rowMid);
        break;
      }

      case "more": {
        ctx.font = `italic 400 ${11.5 * zoom}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = PAL.inkFaint;
        ctx.textAlign = "left";
        ctx.fillText(`+${row.count} more`, padL, rowMid);
        break;
      }

      case "summary": {
        ctx.font = `500 ${10.5 * zoom}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = PAL.inkFaint;
        ctx.textAlign = "left";
        ctx.fillText(row.text, padL, rowMid);
        break;
      }
    }

    ctx.restore();
  }
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  n: SceneNode,
  x: number,
  y: number,
  w: number,
  _h: number,
  showText: boolean,
  isSelected: boolean = false,
  isHovered: boolean = false,
): void {
  const zoom = w / n.w;
  const dh = nodeDisplayH(n) * zoom;
  const hh = HEADER_H * zoom;
  const fam = n.family ?? familyOf(n.type);
  const fCol = famColor(colorOfFamily(fam));
  const r = BORDER_R * zoom;
  const rows = previewRows(n);
  const hasBody = rows.length > 0;

  ctx.save();
  // Multiply (not assign) so reference dimming composes with the caller's alpha
  // (AI pop fade-in + selection-spotlight dim). Absolute assignment here would
  // clobber the spotlight dim → out-of-focus reference nodes wouldn't dim.
  if (n.isReference) ctx.globalAlpha *= 0.85;

  // 1. Two-layer shadow + white card — (a) wide soft ambient, (b) tight
  // contact shadow (settles the edge "on the ground"). Linear/Figma card depth.
  ctx.save();
  rr(ctx, x, y, w, dh, r);
  ctx.fillStyle = PAL.card;
  // a) ambient — black + strong alpha on dark (so the near-black card lifts off the gray field)
  const ambientA = isSelected ? 0.11 : isHovered ? 0.09 : 0.06;
  ctx.shadowOffsetY = (isSelected ? 8 : isHovered ? 6 : 4) * zoom;
  ctx.shadowBlur = (isSelected ? 28 : isHovered ? 22 : 18) * zoom;
  ctx.shadowColor = `rgba(${PAL.shadowRgb}, ${PAL.dark ? Math.min(0.5, ambientA * 4) : ambientA})`;
  ctx.fill();
  // b) contact — same path, second pass
  ctx.shadowOffsetY = 1 * zoom;
  ctx.shadowBlur = 3 * zoom;
  ctx.shadowColor = `rgba(${PAL.shadowRgb}, ${PAL.dark ? 0.4 : 0.08})`;
  ctx.fill();
  ctx.restore();

  // 2. Body off-white fill (clipped to card)
  if (hasBody) {
    ctx.save();
    rr(ctx, x, y, w, dh, r);
    ctx.clip();
    ctx.fillStyle = PAL.bodyBg;
    ctx.fillRect(x, y + hh, w, dh - hh);
    ctx.restore();
  }

  // 3. Header / body divider (1px hairline)
  if (hasBody) {
    ctx.strokeStyle = PAL.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + hh + 0.5);
    ctx.lineTo(x + w, y + hh + 0.5);
    ctx.stroke();
  }

  if (showText) {
    // 4. Icon box (28×28 world units) — slight vertical tint gradient: not "pressed" but
    // a "glossy chip" feel (top 10% → bottom 5% family color).
    const ibSize = 28 * zoom;
    const ibX = x + 14 * zoom;
    const ibY = y + (hh - ibSize) / 2;
    rr(ctx, ibX, ibY, ibSize, ibSize, 7 * zoom);
    const ibGrad = ctx.createLinearGradient(0, ibY, 0, ibY + ibSize);
    // family tone is more saturated on dark → node identity stays distinct on the near-black card
    ibGrad.addColorStop(0, fCol + (PAL.dark ? "33" : "1A"));
    ibGrad.addColorStop(1, fCol + (PAL.dark ? "1A" : "0D"));
    ctx.fillStyle = ibGrad;
    ctx.fill();
    ctx.strokeStyle = fCol + (PAL.dark ? "66" : "33");
    ctx.lineWidth = 1;
    ctx.stroke();

    // Premium geometric icon — vector shape by type
    drawNodeIcon(ctx, n.type, ibX + ibSize / 2, ibY + ibSize / 2, ibSize, fCol);

    // 5. Title (Satoshi 13.5px semibold, premium solid dark — NO tint)
    const textX = ibX + ibSize + 10 * zoom;
    // Family chip removed → title has much wider area
    const maxTextW = Math.max(20 * zoom, x + w - textX - 14 * zoom);
    ctx.font = `600 ${14.5 * zoom}px 'Satoshi', system-ui, sans-serif`;
    ctx.fillStyle = PAL.inkHex; // crisp solid dark
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(clip(ctx, n.name, maxTextW), textX, y + hh / 2 - 1 * zoom);

    // 6. Subtitle (JetBrains Mono 9.5px, lighter gray + tracking — clarifies the title hierarchy)
    ctx.font = `500 ${10.5 * zoom}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "#8A94A3";
    ctx.letterSpacing = `${0.57 * zoom}px`; // ≈0.06em @9.5px
    const sub = subtitleOf(n).toUpperCase();
    ctx.fillText(clip(ctx, sub, maxTextW), textX, y + hh / 2 + 12 * zoom);
    ctx.letterSpacing = "0px";

    // 7. Content rows (left +16px indent — accent strip clearance handled in drawContentRows)
    drawContentRows(ctx, n, x, y + hh, w, zoom);

    // 8. Implementation badge (header top-right) — code completion reported by
    // the Solarch CLI / VS Code extension. Green dot = fully implemented,
    // "n/m" pill = partial (amber) or untouched (red ring).
    if (n.implTotal != null && n.implTotal > 0) {
      drawImplementationBadge(ctx, n, x, y, w, zoom);
    }
  } else {
    // Far zoom: the card becomes a family-colored mini-pill — the diagram's structure reads
    // from afar (color blocks instead of white rectangle + dots).
    rr(ctx, x, y, w, dh, r);
    ctx.fillStyle = fCol + "30";
    ctx.fill();
  }

  // Border — depth now comes from ELEVATION (card lighter than the ground), not a thick
  // colored contour. LIGHT: neutral hairline. DARK: SOFT family tint (20%, calm with the
  // desaturated color) → identity present but no "rainbow"; family lives mainly in the icon
  // box. Hover/selected strengthens it.
  rr(ctx, x, y, w, dh, r);
  let borderStroke = showText ? (PAL.dark ? fCol + "33" : PAL.nodeBorder) : fCol;
  if (isSelected) borderStroke = fCol + (PAL.dark ? "C0" : "80");
  else if (isHovered) borderStroke = fCol + (PAL.dark ? "8C" : "4D");
  ctx.strokeStyle = borderStroke;
  ctx.lineWidth = 1;
  if (n.isReference) ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  // 10. Selection halo — soft accent ring outside (brand-accent)
  if (isSelected) {
    rr(ctx, x - 2, y - 2, w + 4, dh + 4, r + 2);
    ctx.strokeStyle = "rgba(255,138,61,0.30)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.restore();
}

/** Implementation completion badge — top-right corner of the header.
 *  Fully filled: green dot + check feel. Partial: amber "n/m" pill.
 *  Untouched: red hollow ring + "0/m". AI share is shown in the tooltip (Inspector). */
function drawImplementationBadge(
  ctx: CanvasRenderingContext2D,
  n: SceneNode,
  x: number,
  y: number,
  w: number,
  zoom: number,
): void {
  const total = n.implTotal ?? 0;
  const filled = n.implFilled ?? 0;
  const done = filled >= total;
  const none = filled === 0;
  const padR = 10 * zoom;
  const badgeY = y + 11 * zoom;

  if (done) {
    // Green filled dot — quiet success signal.
    const rDot = 3.5 * zoom;
    const cx = x + w - padR - rDot;
    ctx.beginPath();
    ctx.arc(cx, badgeY, rDot, 0, Math.PI * 2);
    ctx.fillStyle = "#10B981";
    ctx.fill();
    ctx.strokeStyle = "rgba(16,185,129,0.30)";
    ctx.lineWidth = 2 * zoom;
    ctx.stroke();
    return;
  }

  const text = `${filled}/${total}`;
  ctx.font = `700 ${9.5 * zoom}px 'JetBrains Mono', monospace`;
  const tw = ctx.measureText(text).width;
  const padX = 4 * zoom;
  const bh = 13 * zoom;
  const bw = tw + padX * 2 + 7 * zoom; // + status dot area
  const bx = x + w - padR - bw;

  rr(ctx, bx, badgeY - bh / 2, bw, bh, 3 * zoom);
  ctx.fillStyle = none ? "rgba(220, 38, 38, 0.07)" : "rgba(217, 119, 6, 0.08)";
  ctx.fill();
  ctx.strokeStyle = none ? "rgba(220, 38, 38, 0.28)" : "rgba(217, 119, 6, 0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Status dot (to the left, inside the pill)
  const dotR = 2 * zoom;
  const dotX = bx + padX + dotR;
  ctx.beginPath();
  ctx.arc(dotX, badgeY, dotR, 0, Math.PI * 2);
  if (none) {
    ctx.strokeStyle = "#DC2626";
    ctx.lineWidth = 1.4 * zoom;
    ctx.stroke(); // hollow ring — not started
  } else {
    ctx.fillStyle = "#D97706";
    ctx.fill();
  }

  ctx.fillStyle = none ? "#991B1B" : "#92400E";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, dotX + dotR + 3 * zoom, badgeY + 0.5 * zoom);
}

function segmentVisible(a: SceneNode, b: SceneNode, vp: Viewport, w: number, h: number): boolean {
  const ax = sx(a.x, vp), ay = sy(a.y, vp), bx = sx(b.x, vp), by = sy(b.y, vp);
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx) + a.w * vp.zoom;
  const minY = Math.min(ay, by), maxY = Math.max(ay, by) + nodeDisplayH(a) * vp.zoom;
  return maxX > -8 && minX < w + 8 && maxY > -8 && minY < h + 8;
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return "";
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}
