import type { Node } from "../schemas";
import type { SuccessEnvelope } from "../../common/envelope";

export type NodeResponse = SuccessEnvelope<Node>;
export type NodeListResponse = SuccessEnvelope<{ nodes: Node[]; total: number }>;
