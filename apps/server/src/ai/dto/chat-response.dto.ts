import type { SuccessEnvelope } from "../../common/envelope";
import type { Node } from "../../nodes/schemas";
import type { Edge } from "../../edges/schemas/edge.schema";

export interface ChatResult {
  /** AI'ın kullanıcıya dönen Türkçe yanıtı. */
  reply: string;
  /** Mimari uygulandıysa sonuç (idMap + sayılar); uygulanmadıysa null. */
  applied: {
    idMap: Record<string, string>;
    nodeCount: number;
    edgeCount: number;
  } | null;
  /** Kaç tool-call denemesi yapıldı (ReAct loop). */
  attempts: number;
}

export type ChatResponse = SuccessEnvelope<ChatResult>;

/** chatStream() yield event'leri — SSE'ye encode edilir.
 *  Frontend EventSource event tipi: "node" | "edge" | "text-delta" | "done" | "error". */
export type StreamEvent =
  | { type: "node"; data: Node }
  | { type: "edge"; data: Edge }
  | { type: "text-delta"; delta: string }  // instruct mode incremental text
  | { type: "removed"; data: { id: string; kind: "node" | "edge"; reason: string } } // terminal rollback: orphan temizliği
  | { type: "done"; message: string; counts: { nodes: number; edges: number }; attempts: number }
  // Adım limiti (MAX_TURNS) doldu, iş bitmedi — orphan TEMİZLENMEZ; "Devam et" ile sürer.
  | { type: "paused"; code: string; message: string; counts: { nodes: number; edges: number }; attempts: number }
  | { type: "error"; code: string; message: string };
