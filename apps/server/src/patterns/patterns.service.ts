import { Injectable, Inject, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PatternsRepository, type PatternSearchHit } from "./patterns.repository";
import { ProjectsRepository } from "../projects/projects.repository";
import { EMBEDDINGS, type IEmbeddings } from "../embeddings/embeddings.types";
import type { CreatePatternInput, StoredPattern, PatternSummary, PatternGraph } from "./schemas/pattern.schema";

@Injectable()
export class PatternsService {
  constructor(
    private readonly repo: PatternsRepository,
    private readonly projectsRepo: ProjectsRepository,
    @Inject(EMBEDDINGS) private readonly embeddings: IEmbeddings,
  ) {}

  private embedText(p: { name: string; description: string; tags: string[] }): string {
    return `${p.name}\n${p.description}\n${p.tags.join(" ")}`;
  }

  async create(input: CreatePatternInput, source: "seed" | "promoted" = "seed"): Promise<PatternSummary> {
    this.assertEmbeddings();
    const stored: StoredPattern = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      tags: input.tags,
      graph: input.graph,
      source,
      createdAt: new Date().toISOString(),
    };
    const vec = await this.embeddings.embed(this.embedText(stored));
    await this.repo.create(stored, vec);
    return summarize(stored);
  }

  list(): Promise<PatternSummary[]> {
    return this.repo.list();
  }

  async getById(id: string): Promise<StoredPattern> {
    const p = await this.repo.getById(id);
    if (!p) throw new NotFoundException({ code: "ERR_PATTERN_NOT_FOUND", message: `Pattern '${id}' not found.` });
    return p;
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repo.delete(id)))
      throw new NotFoundException({ code: "ERR_PATTERN_NOT_FOUND", message: `Pattern '${id}' not found.` });
  }

/** Embeds the query and returns top-K. Empty (gradient) if embedding is not configured. */
  async search(query: string, k: number, minScore: number): Promise<PatternSearchHit[]> {
    if (!this.embeddings.isConfigured()) return [];
    const vec = await this.embeddings.embed(query);
    return this.repo.search(vec, k, minScore);
  }

/** Promote pattern from project graph. If nodeIds are not given, the entire project. */
  async promoteFromProject(
    projectId: string,
    input: { name: string; description: string; tags?: string[]; nodeIds?: string[] },
  ): Promise<PatternSummary> {
    const project = await this.projectsRepo.getById(projectId);
    if (!project)
      throw new NotFoundException({ code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' not found.` });

    const { nodes, edges } = await this.projectsRepo.getGraph(projectId);
    const selected = input.nodeIds?.length
      ? nodes.filter((n: any) => input.nodeIds!.includes(n.id))
      : nodes;
    if (selected.length === 0)
      throw new NotFoundException({ code: "ERR_PATTERN_NODE_NOT_FOUND", message: "The selected nodeIds were not found in the project." });

// actual id → tempId; Only edges between selected nodes are moved.
    const idToTemp = new Map<string, string>();
    selected.forEach((n: any, i: number) => idToTemp.set(n.id, `t_${i}_${String(n.type).toLowerCase()}`));
    const graph: PatternGraph = {
      nodes: selected.map((n: any) => ({ tempId: idToTemp.get(n.id)!, type: n.type, properties: n.properties })),
      edges: edges
        .filter((e: any) => idToTemp.has(e.sourceNodeId) && idToTemp.has(e.targetNodeId))
        .map((e: any) => ({
          sourceTempId: idToTemp.get(e.sourceNodeId)!,
          targetTempId: idToTemp.get(e.targetNodeId)!,
          edgeType: e.kind,
          label: e.properties?.Label,
        })),
    };
    return this.create({ name: input.name, description: input.description, tags: input.tags ?? [], graph }, "promoted");
  }

  private assertEmbeddings(): void {
    if (!this.embeddings.isConfigured())
      throw new ServiceUnavailableException({
        code: "ERR_EMBEDDINGS_NOT_CONFIGURED",
        message: "Embedding provider is not configured.",
      });
  }
}

function summarize(p: StoredPattern): PatternSummary {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    tags: p.tags,
    source: p.source,
    createdAt: p.createdAt,
    nodeCount: p.graph.nodes.length,
    edgeCount: p.graph.edges.length,
  };
}
