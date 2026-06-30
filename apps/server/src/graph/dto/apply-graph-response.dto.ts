import type { SuccessEnvelope } from "../../common/envelope";

export interface ApplyViolation {
  /** Node ihlali ise tempId; edge ihlali ise edgeIndex. */
  tempId?: string;
  edgeIndex?: number;
  source?: { tempId?: string; id?: string; type?: string };
  target?: { tempId?: string; id?: string; type?: string };
  attemptedEdgeType?: string;
  code: string;
  message: string;
  suggestion?: string;
  details?: Array<{ field: string; issue: string }>;
}

export interface ApplyGraphSuccess {
  success: true;
  /** tempId → kalıcı UUID eşlemesi */
  idMap: Record<string, string>;
  nodeCount: number;
  edgeCount: number;
  /** Commit sonrası graf revizyonu — istemci bir sonraki push'ta baseRevision olarak kullanır. */
  graphRevision: number;
}

export interface ApplyGraphFailure {
  success: false;
  transactionStatus: "ROLLED_BACK";
  message: string;
  violations: ApplyViolation[];
}

export type ApplyGraphResult = ApplyGraphSuccess | ApplyGraphFailure;
export type ApplyGraphResponse = SuccessEnvelope<ApplyGraphResult>;
