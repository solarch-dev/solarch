import type { Edge } from "../schemas/edge.schema";
import type { SuccessEnvelope } from "../../common/envelope";

export type EdgeResponse = SuccessEnvelope<Edge>;
export type EdgeListResponse = SuccessEnvelope<{ edges: Edge[]; total: number }>;

/** Bloklamayan kural uyarısı (örn. WARN_COND_001 boş-tablo). Edge yine yaratılır;
 *  uyarı yalnızca kullanıcıya gösterilmek üzere response'a iliştirilir. */
export interface EdgeWarning {
  code: string;
  message: string;
  suggestion?: string;
}

/** Edge oluşturma yanıtı. `data.warning` opsiyonel — tipli OpenAPI client'ı
 *  runtime davranışıyla senkron tutar (EdgesService.create `Edge & { warning? }` döner). */
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
