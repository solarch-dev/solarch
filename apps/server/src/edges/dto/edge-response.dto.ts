import type { Edge } from "../schemas/edge.schema";
import type { SuccessEnvelope } from "../../common/envelope";

export type EdgeResponse = SuccessEnvelope<Edge>;
export type EdgeListResponse = SuccessEnvelope<{ edges: Edge[]; total: number }>;

/** Non-blocking rule warning (e.g. WARN_COND_001 empty-tab). Edge is still created;
 *  warning attached to response for display to user only. */
export interface EdgeWarning {
  code: string;
  message: string;
  suggestion?: string;
}

/** Edge creation response. `data.warning` optional — keeps typed OpenAPI client
 *  in sync with runtime behavior (EdgesService.create returns `Edge & { warning? }`). */
export type EdgeCreatedResponse = SuccessEnvelope<Edge & { warning?: EdgeWarning }>;

export interface EdgeValidationResult {
  isValid: boolean;
  engineResult?: {
    code: string;
    ruleViolated?: string;
    message: string;
    suggestion?: string;
    docLink?: string;
  };
}

export type EdgeValidationResponse = SuccessEnvelope<EdgeValidationResult>;
