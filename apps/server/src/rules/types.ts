import type { NodeKind } from "../nodes/schemas";
import type { EdgeKind } from "../edges/schemas/edge.schema";
import type { StoredNode } from "../nodes/nodes.repository";

export type NodeKindOrWildcard = NodeKind | "*";
export type EdgeKindOrWildcard = EdgeKind | "*";

/** Whitelist allow rule — Plans/Rules Matrix permitted connections. */
export interface AllowRule {
  source: NodeKind | NodeKind[];
  edge: EdgeKind | EdgeKind[];
  target: NodeKind | NodeKind[];
  layer: RuleLayer;
  note?: string;
}

/** Blacklist deny rule — Plans/Rules Matrix hard prohibitions (ERR_001..007). */
export interface DenyRule {
  code: string;
  source: NodeKindOrWildcard | NodeKindOrWildcard[];
  edge: EdgeKindOrWildcard | EdgeKindOrWildcard[];
  target: NodeKindOrWildcard | NodeKindOrWildcard[];
  message: string;
  suggestion: string;
  docLink?: string;
}

/** Conditional rule descriptor — checkers run at runtime. */
export interface ConditionalRuleDescriptor {
  code: string;
  type: "CIRCULAR_DEPENDENCY" | "TYPE_MISMATCH" | "EMPTY_SCHEMA";
  severity: "error" | "warning";
  description: string;
  appliesWhen: string;
}

export type RuleLayer =
  | "client"
  | "presentation"
  | "business"
  | "background"
  | "data"
  | "schema"
  | "structure";

export const RULE_LAYER_LABELS: Record<RuleLayer, string> = {
  client: "1. Client and External Access",
  presentation: "2. Processing and Presentation",
  business: "3. Business Logic",
  background: "4. Background and Async",
  data: "5. Data Access",
  schema: "6. Data, Schema and Inheritance",
  structure: "7. Modular Structure",
};

export interface EvaluationContext {
  projectId: string;
  sourceNode: StoredNode;
  targetNode: StoredNode;
  edgeKind: EdgeKind;
}

export interface EvaluationResult {
  allowed: boolean;
  severity?: "error" | "warning";
  code?: string;
  ruleViolated?: string;
  message?: string;
  suggestion?: string;
  docLink?: string;
}

/** Whole-graph review finding — rule violation/warning on an existing edge.
 *  Returned by POST /projects/:id/review; frontend Problems panel displays it. */
export interface ReviewFinding {
  severity: "error" | "warning";
  code: string;
  message: string;
  suggestion?: string;
  ruleViolated?: string;
  docLink?: string;
  edgeId: string;
  edgeKind: EdgeKind;
  /** [sourceId, targetId] — for frontend focusNode/focusEdge. */
  nodeIds: string[];
}

export const CLIENT_KINDS: NodeKind[] = ["FrontendApp", "UIComponent"];
export const DATA_KINDS: NodeKind[] = ["Table", "View", "DTO", "Enum", "Model"];
export const PASSIVE_KINDS: NodeKind[] = ["Table", "View", "DTO", "Enum"];
export const ACTIVE_KINDS: NodeKind[] = [
  "Service",
  "Controller",
  "APIGateway",
  "Worker",
  "EventHandler",
  "Orchestrator",
  "Repository",
  "Middleware",
];
