import type { SuccessEnvelope } from "../../common/envelope";
import type { Node } from "../../nodes/schemas";
import type { Edge } from "../../edges/schemas/edge.schema";

export interface ChatResult {
  /** AI reply text returned to the user. */
  reply: string;
  /** Result when architecture was applied (idMap + counts); null if not applied. */
  applied: {
    idMap: Record<string, string>;
    nodeCount: number;
    edgeCount: number;
  } | null;
  /** Number of tool-call attempts (ReAct loop). */
  attempts: number;
}

export type ChatResponse = SuccessEnvelope<ChatResult>;

/** chatStream() yield events — encoded to SSE.
 *  Frontend EventSource event type: "node" | "edge" | "text-delta" | "done" | "error". */
export type StreamEvent =
  | { type: "node"; data: Node }
  | { type: "edge"; data: Edge }
  | { type: "text-delta"; delta: string }  // instruct mode incremental text
  | { type: "removed"; data: { id: string; kind: "node" | "edge"; reason: string } } // terminal rollback: orphan cleanup
  | { type: "done"; message: string; counts: { nodes: number; edges: number }; attempts: number }
  // Step limit (MAX_TURNS) reached, work unfinished — orphans NOT cleaned; resumes via "Continue".
  | { type: "paused"; code: string; message: string; counts: { nodes: number; edges: number }; attempts: number }
  | { type: "error"; code: string; message: string };
