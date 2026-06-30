/** Simple view — PROJECTION types (lean model derived from the technical graph).
 *
 *  These types are the DATA CONTRACT for both levels. In Phase 1 a hand-written
 *  fixture fills them (visual only). In Phase 2 pure functions `systemMap(graph)` /
 *  `capabilities(graph, slug)` produce the same shape from the CodeGraph — the
 *  components don't change. The presentation counterpart of the "the system owns
 *  the wiring" principle: structure is deterministic, labels come from a rule
 *  table; the component only RENDERS. */

/** Data a capability touches: write (saves) or read (reads). */
export type DataAccess = "writes" | "reads";

export interface CapabilityDatum {
  access: DataAccess;
  /** Human-readable plural table name ("Messages", "Chats"). */
  label: string;
}

/** The single thing a feature can do (the plain counterpart of an endpoint). */
export interface Capability {
  /** "Signed-in user" / "Any user" / role name. */
  actor: string;
  /** Action phrase: "Sends a message", "Views chats". */
  action: string;
  /** Data touched (saves/reads) — two separate tables NEVER merge. */
  data: CapabilityDatum[];
  /** Other features this action triggers ("Notification"). */
  triggers?: string[];
  /** External services used ("SendGrid"). */
  external?: string[];
  /** Number of hidden technical details (DTO/Cache/Middleware… → "+N details"). */
  hidden: number;
}

/** Flowchart shape glossary (classic): terminal=start/end, process=step,
 *  decision=decision (diamond, branches), data=data (saves/reads), external=external service. */
export type FlowNodeKind = "terminal" | "process" | "decision" | "data" | "external" | "end" | "state";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  /** for data nodes: write (saves) / read (reads). */
  access?: DataAccess;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** Label of the branch leaving a decision node ("Yes" / "No" / condition). */
  label?: string;
}

/** A capability's logic diagram (auto-laid out; dagre layered + orthogonal). */
export interface CapabilityFlow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** A feature box in the system map. */
export interface FeatureBox {
  slug: string;
  /** "Messaging", "Authentication". */
  title: string;
  /** Layer label: "CORE" (infrastructure) / "PRODUCT" / "" (for tier columns). */
  tier: number;
  /** "N capabilities" counter. */
  capabilityCount: number;
  /** Plural table names ("Messages", "Chats"). */
  dataLabels: string[];
  /** External services ("SendGrid"). */
  external?: string[];
  /** Capability list revealed when this box is clicked. */
  capabilities: Capability[];
  /** ONE consolidated flowchart for the whole feature: a single shared "Signed in?"
   *  gate + each operation as a leaf (no per-operation repetition, no Start/End). */
  flowGraph?: CapabilityFlow;
}

/** Relationship between two boxes. */
export interface FeatureArrow {
  from: string; // source slug
  to: string; // target slug
  /** "uses" (dependsOn) / "triggers" (publish→subscribe). */
  label: string;
  /** Mutual dependency (forwardRef) → dashed arrow. */
  mutual?: boolean;
}

/** The full system map (Level A). */
export interface SystemMap {
  features: FeatureBox[];
  arrows: FeatureArrow[];
  /** Shared infrastructure that falls into "common", used by every part. */
  shared?: { items: string[] };
}
