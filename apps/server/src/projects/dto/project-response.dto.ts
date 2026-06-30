import type { Project } from "../schemas/project.schema";
import type { Node } from "../../nodes/schemas";
import type { Edge } from "../../edges/schemas/edge.schema";
import type { SuccessEnvelope } from "../../common/envelope";

export interface ProjectWithCounts extends Project {
  counts: { nodes: number; edges: number };
}

export interface ProjectGraph {
  project: Project;
  nodes: Node[];
  edges: Edge[];
  counts: { nodes: number; edges: number };
  /** Graf seviyesi revizyon — her yapısal mutasyonda +1. CLI push'un
   *  baseRevision çatışma tespiti bu değere dayanır. */
  graphRevision: number;
}

export type ProjectResponse = SuccessEnvelope<ProjectWithCounts>;
export type ProjectListResponse = SuccessEnvelope<{ projects: ProjectWithCounts[]; total: number }>;
export type ProjectGraphResponse = SuccessEnvelope<ProjectGraph>;
