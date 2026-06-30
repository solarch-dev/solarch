import type { SuccessEnvelope } from "../../common/envelope";

export interface ApplyViolation {
  /** tempId for node violation; edgeIndex for edge violation. */
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
  /** tempId -> persistent UUID mapping */
  idMap: Record<string, string>;
  nodeCount: number;
  edgeCount: number;
  /** Post-commit graph revision — client uses as baseRevision on next push. */
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
