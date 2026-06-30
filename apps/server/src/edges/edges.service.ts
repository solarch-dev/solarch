import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { EdgesRepository, type EdgeFilter, type StoredEdge } from "./edges.repository";
import { NodesRepository } from "../nodes/nodes.repository";
import { ProjectsRepository } from "../projects/projects.repository";
import { RulesEngine } from "../rules/rules.engine";
import type { EvaluationResult } from "../rules/types";
import type { Edge, EdgeKind, EdgeProperties } from "./schemas/edge.schema";
import type { EdgeWarning } from "./dto/edge-response.dto";

type CreateInput = Omit<Edge, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export interface UpdateInput {
  properties?: EdgeProperties;
  kind?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
}

export interface ValidateInput {
  sourceNodeId: string;
  targetNodeId: string;
  kind: EdgeKind;
}

@Injectable()
export class EdgesService {
  constructor(
    private readonly repo: EdgesRepository,
    private readonly nodesRepo: NodesRepository,
    private readonly projectsRepo: ProjectsRepository,
    private readonly rulesEngine: RulesEngine,
  ) {}

  async create(urlProjectId: string, input: CreateInput): Promise<Edge & { warning?: EdgeWarning }> {
    if (input.projectId !== urlProjectId) {
      throw new BadRequestException({
        code: "ERR_PROJECT_MISMATCH",
        message: "The projectId in the URL does not match the projectId in the body.",
      });
    }

    if (!(await this.projectsRepo.exists(urlProjectId))) {
      throw new NotFoundException({
        code: "ERR_PROJECT_NOT_FOUND",
        message: `Project '${urlProjectId}' not found. Create a project first via POST /api/v1/projects.`,
      });
    }

    if (input.sourceNodeId === input.targetNodeId) {
      throw new BadRequestException({
        code: "ERR_EDGE_SELF_LOOP",
        message: "A node cannot connect to itself (self-loops are forbidden).",
      });
    }

    // Node existence
    const exist = await this.repo.nodesExist(urlProjectId, input.sourceNodeId, input.targetNodeId);
    if (!exist.source) {
      throw new NotFoundException({
        code: "ERR_EDGE_SOURCE_NOT_FOUND",
        message: `Source node '${input.sourceNodeId}' not found in this project.`,
      });
    }
    if (!exist.target) {
      throw new NotFoundException({
        code: "ERR_EDGE_TARGET_NOT_FOUND",
        message: `Target node '${input.targetNodeId}' not found in this project.`,
      });
    }

    // ID conflict
    if (input.id) {
      const existing = await this.repo.getById(urlProjectId, input.id);
      if (existing) {
        throw new ConflictException({
          code: "ERR_ID_CONFLICT",
          message: `Edge id '${input.id}' is already in use.`,
        });
      }
    }

    // Duplicate (same source/target/kind)
    const dup = await this.repo.existsBetween(urlProjectId, input.sourceNodeId, input.targetNodeId, input.kind);
    if (dup) {
      throw new ConflictException({
        code: "ERR_EDGE_DUPLICATE",
        message: `An '${input.kind}' edge already exists between this source/target.`,
      });
    }

    // Rules Engine — full node fetch + evaluate
    const sourceNode = await this.nodesRepo.getById(urlProjectId, input.sourceNodeId);
    const targetNode = await this.nodesRepo.getById(urlProjectId, input.targetNodeId);
    // Bloklamayan uyarı (örn. WARN_COND_001 boş-tablo) — edge yine yaratılır ama
    // response'a iliştirilip kullanıcıya gösterilir (sessizce yutulmasın).
    let warning: EdgeWarning | undefined;
    if (sourceNode && targetNode) {
      const evaluation = await this.rulesEngine.evaluate({
        projectId: urlProjectId,
        sourceNode,
        targetNode,
        edgeKind: input.kind,
      });
      if (!evaluation.allowed) {
        throw new ConflictException({
          code: evaluation.code ?? "ERR_RULES_DENIED",
          message: evaluation.message ?? "The connection violates the rules.",
          ruleViolated: evaluation.ruleViolated,
          suggestion: evaluation.suggestion,
          docLink: evaluation.docLink,
        });
      }
      if (evaluation.severity === "warning" && evaluation.code) {
        warning = { code: evaluation.code, message: evaluation.message ?? "", suggestion: evaluation.suggestion };
      }
    }

    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const stored: StoredEdge = {
      id,
      projectId: urlProjectId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      kind: input.kind,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      properties: input.properties,
    };
    // repo.create idempotent (apoc.merge) + endpoint'leri atomik MATCH eder.
    // null → endpoint(ler) bu an silinmiş (check ile create arası race).
    const persisted = await this.repo.create(stored);
    if (!persisted) {
      throw new NotFoundException({
        code: "ERR_EDGE_ENDPOINT_NOT_FOUND",
        message: "Edge could not be created — the source/target node does not currently exist.",
      });
    }
    await this.projectsRepo.bumpRevision(urlProjectId);
    return { ...this.toEdge(persisted), ...(warning ? { warning } : {}) };
  }

  async getById(projectId: string, id: string): Promise<Edge> {
    const stored = await this.repo.getById(projectId, id);
    if (!stored) {
      throw new NotFoundException({
        code: "ERR_EDGE_NOT_FOUND",
        message: `Edge '${id}' not found.`,
      });
    }
    return this.toEdge(stored);
  }

  async list(projectId: string, filter: EdgeFilter = {}): Promise<Edge[]> {
    const stored = await this.repo.list(projectId, filter);
    return stored.map((s) => this.toEdge(s));
  }

  async update(projectId: string, id: string, input: UpdateInput): Promise<Edge> {
    if (input.kind !== undefined || input.sourceNodeId !== undefined || input.targetNodeId !== undefined) {
      throw new BadRequestException({
        code: "ERR_EDGE_IMMUTABLE",
        message: "An edge's kind / sourceNodeId / targetNodeId fields cannot be changed. Delete and recreate.",
      });
    }
    if (!input.properties) {
      throw new BadRequestException({
        code: "ERR_PATCH_EMPTY",
        message: "No field to change in the PATCH body (only properties can be updated).",
      });
    }
    const updatedAt = new Date().toISOString();
    const stored = await this.repo.updateProperties(projectId, id, input.properties, updatedAt);
    if (!stored) {
      throw new NotFoundException({
        code: "ERR_EDGE_NOT_FOUND",
        message: `Edge '${id}' not found.`,
      });
    }
    await this.projectsRepo.bumpRevision(projectId);
    return this.toEdge(stored);
  }

  async delete(projectId: string, id: string): Promise<void> {
    const ok = await this.repo.delete(projectId, id);
    if (!ok) {
      throw new NotFoundException({
        code: "ERR_EDGE_NOT_FOUND",
        message: `Edge '${id}' not found.`,
      });
    }
    await this.projectsRepo.bumpRevision(projectId);
  }

  /** Pre-check: node existence + duplicate. Phase 2B'de Rules Engine eklenecek. */
  async validate(projectId: string, input: ValidateInput) {
    if (input.sourceNodeId === input.targetNodeId) {
      return {
        isValid: false,
        engineResult: {
          code: "ERR_EDGE_SELF_LOOP",
          message: "A node cannot connect to itself.",
          suggestion: "Choose a different target node.",
        },
      };
    }
    const exist = await this.repo.nodesExist(projectId, input.sourceNodeId, input.targetNodeId);
    if (!exist.source) {
      return {
        isValid: false,
        engineResult: {
          code: "ERR_EDGE_SOURCE_NOT_FOUND",
          message: `Source node '${input.sourceNodeId}' yok.`,
        },
      };
    }
    if (!exist.target) {
      return {
        isValid: false,
        engineResult: {
          code: "ERR_EDGE_TARGET_NOT_FOUND",
          message: `Target node '${input.targetNodeId}' yok.`,
        },
      };
    }
    const dup = await this.repo.existsBetween(projectId, input.sourceNodeId, input.targetNodeId, input.kind);
    if (dup) {
      return {
        isValid: false,
        engineResult: {
          code: "ERR_EDGE_DUPLICATE",
          message: `The same '${input.kind}' edge already exists between these nodes.`,
        },
      };
    }

    // Rules Engine
    const sourceNode = await this.nodesRepo.getById(projectId, input.sourceNodeId);
    const targetNode = await this.nodesRepo.getById(projectId, input.targetNodeId);
    if (sourceNode && targetNode) {
      const evaluation = await this.rulesEngine.evaluate({
        projectId,
        sourceNode,
        targetNode,
        edgeKind: input.kind,
      });
      return this.toValidationResult(evaluation);
    }

    return { isValid: true, engineResult: undefined };
  }

  private toValidationResult(e: EvaluationResult) {
    if (e.allowed && !e.code) return { isValid: true, engineResult: undefined };
    return {
      isValid: e.allowed,
      severity: e.severity,
      engineResult: {
        code: e.code!,
        ruleViolated: e.ruleViolated,
        message: e.message!,
        suggestion: e.suggestion,
        docLink: e.docLink,
      },
    };
  }

  private toEdge(s: StoredEdge): Edge {
    return {
      id: s.id,
      projectId: s.projectId,
      sourceNodeId: s.sourceNodeId,
      targetNodeId: s.targetNodeId,
      kind: s.kind,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      properties: s.properties,
    };
  }
}
