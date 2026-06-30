/** Solarch edge visual style table — 16 kinds, semantic color/dash/marker.
 *  Linear/Vercel/Figma level muted, refined palette (Tailwind 500-600 tones).
 *  Colors are independent of the family palette — edges have their own semantic layer. */

export type MarkerKind =
  | "filledTri"
  | "openTri"
  | "filledDiamond"
  | "openCircle"
  | "filledDot"
  | "doubleTri"
  | "bar"          // short perpendicular line (cardinality "one"/"exactly_one" basis)
  | "crowMany"     // ER crow's foot — "many"
  | "crowOne"      // bar — "exactly one"
  | "crowZeroOne"  // ○─ — "zero or one"
  | "crowOneMany"; // ─∢ — "one or many"

export interface EdgeStyle {
  color: string;
  dash: number[]; // [] = solid
  width: number;  // world units (multiplied by zoom)
  marker: MarkerKind;
}

// Refined muted palette — Tailwind 500-600 tones
// (previous: saturated FAMILY_COLOR colors — created neon "rainbow" effect)
const INDIGO       = "#4f46e5"; // indigo-600 — sync call (CALLS, REQUESTS)
const INDIGO_SOFT  = "#6366f1"; // indigo-500 — ROUTES_TO (gateway, slightly lighter)
const VIOLET       = "#7c3aed"; // violet-600 — async event (PUBLISHES, SUBSCRIBES)
const CYAN         = "#0891b2"; // cyan-600 — DB I/O (QUERIES, WRITES) — muted teal
const ORANGE       = "#ea580c"; // orange-600 — cache (CACHES_IN) — cleaner bronze
const GREEN        = "#16a34a"; // green-600 — config (READS_CONFIG)
const SLATE        = "#64748b"; // slate-500 — schema/general (USES, HAS, RETURNS)
const SLATE_DARK   = "#475569"; // slate-600 — OO inheritance (EXTENDS, IMPLEMENTS)
const SLATE_FAINT  = "#94a3b8"; // slate-400 — soft dependencies (DEPENDS_ON)
const AMBER        = "#d97706"; // amber-600 — THROWS warning

// Width policy: all 2 — exactly matches node border width (2px).
// Semantic emphasis is conveyed by dash/color, not thickness.
const W_NORMAL = 2;
const W_EMPHASIS = 2;

export const EDGE_STYLES: Record<string, EdgeStyle> = {
  // 1. Call & Communication
  CALLS:      { color: INDIGO,      dash: [],      width: W_EMPHASIS, marker: "filledTri" },
  REQUESTS:   { color: INDIGO,      dash: [],      width: W_EMPHASIS, marker: "filledTri" },
  PUBLISHES:  { color: VIOLET,      dash: [5, 5],  width: W_EMPHASIS, marker: "openCircle" },
  SUBSCRIBES: { color: VIOLET,      dash: [5, 5],  width: W_EMPHASIS, marker: "filledDot" },
  // 2. Data & Schema
  USES:       { color: SLATE,       dash: [],      width: W_NORMAL,   marker: "filledTri" },
  HAS:        { color: SLATE,       dash: [],      width: W_NORMAL,   marker: "filledDiamond" },
  EXTENDS:    { color: SLATE_DARK,  dash: [],      width: W_EMPHASIS, marker: "openTri" },
  IMPLEMENTS: { color: SLATE_DARK,  dash: [4, 4],  width: W_EMPHASIS, marker: "openTri" },
  RETURNS:    { color: SLATE,       dash: [],      width: W_NORMAL,   marker: "openTri" },
  // 3. DB & Infrastructure — crow's foot cardinality
  QUERIES:    { color: CYAN,        dash: [],      width: W_EMPHASIS, marker: "crowMany" },
  WRITES:     { color: CYAN,        dash: [],      width: W_EMPHASIS, marker: "crowMany" },
  CACHES_IN:  { color: ORANGE,      dash: [],      width: W_EMPHASIS, marker: "filledTri" },
  // 4. Architecture
  DEPENDS_ON:    { color: SLATE_FAINT,  dash: [3, 4],  width: W_NORMAL,   marker: "openTri" },
  READS_CONFIG:  { color: GREEN,        dash: [],      width: W_NORMAL,   marker: "filledTri" },
  THROWS:        { color: AMBER,        dash: [5, 5],  width: W_EMPHASIS, marker: "filledTri" },
  ROUTES_TO:     { color: INDIGO_SOFT,  dash: [],      width: W_EMPHASIS, marker: "filledTri" },
};

const FALLBACK: EdgeStyle = { color: SLATE, dash: [], width: W_NORMAL, marker: "filledTri" };

/** Kind + optional IsAsync → final style. Forces dash on sync edges marked async. */
export function getEdgeStyle(kind: string, isAsync?: boolean): EdgeStyle {
  const base = EDGE_STYLES[kind] ?? FALLBACK;
  if (isAsync && base.dash.length === 0) return { ...base, dash: [5, 5] };
  return base;
}

/** State overlays for rules violations or pending state. */
export const EDGE_STATE = {
  invalidColor: "#c92a2a",      // only for rules violations (THROWS is amber, no conflict)
  invalidDash: [4, 3] as number[],
  selectedGlowAlpha: 0.55,
  pendingAlpha: 0.55,
} as const;
