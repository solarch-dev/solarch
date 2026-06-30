import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Neo4jService } from "../neo4j/neo4j.service";
import { ProjectsRepository } from "../projects/projects.repository";
import { NodesRepository, type StoredNode } from "../nodes/nodes.repository";
import { RulesEngine } from "../rules/rules.engine";
import { TabsService } from "../tabs/tabs.service";
import { NodeSchema, type NodeKind } from "../nodes/schemas";
import { assertNoPlaintextSecret } from "../nodes/secret-redaction";
import type { EdgeKind } from "../edges/schemas/edge.schema";
import type { ApplyGraphInput } from "./dto/apply-graph.dto";
import type {
  ApplyGraphResult,
  ApplyViolation,
} from "./dto/apply-graph-response.dto";

const GRID_COLS = 5;
const GRID_X = 280;
const GRID_Y = 180;

@Injectable()
export class GraphService {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly projectsRepo: ProjectsRepository,
    private readonly nodesRepo: NodesRepository,
    private readonly rulesEngine: RulesEngine,
    private readonly tabs: TabsService,
  ) {}

  async apply(projectId: string, input: ApplyGraphInput): Promise<ApplyGraphResult> {
    if (!(await this.projectsRepo.exists(projectId))) {
      throw new NotFoundException({
        code: "ERR_PROJECT_NOT_FOUND",
        message: `Project '${projectId}' not found. Create a project first via POST /api/v1/projects.`,
      });
    }

    // Conflict pre-check: if revision client used for delta is stale, 409 without writing.
    // (Actual atomic guarantee is repeated in commit transaction.)
    if (input.baseRevision !== undefined) {
      const current = await this.projectsRepo.getGraphRevision(projectId);
      if (current !== input.baseRevision) {
        throw this.revisionConflict(input.baseRevision, current);
      }
    }

    const { nodes, edges } = input.mutations;
    // Home tab for generated nodes: given tabId or project default tab.
    const homeTabId = input.tabId ?? (await this.tabs.ensureDefault(projectId)).id;
    const violations: ApplyViolation[] = [];
    const idMap: Record<string, string> = {};
    const nodeMap = new Map<string, StoredNode>();
    const now = new Date().toISOString();

    // ── 1. tempId uniqueness ───────────────────────────────────────
    const seenTempIds = new Set<string>();
    for (const node of nodes) {
      if (seenTempIds.has(node.tempId)) {
        violations.push({
          tempId: node.tempId,
          code: "ERR_DUPLICATE_TEMP_ID",
          message: `tempId '${node.tempId}' was used more than once.`,
        });
      }
      seenTempIds.add(node.tempId);
    }

    // ── 2. node schema validation + grid position ────────────────────────
    nodes.forEach((node, i) => {
      const id = randomUUID();
      const candidate = {
        id,
        type: node.type,
        projectId,
        position: gridPosition(i),
        createdAt: now,
        updatedAt: now,
        properties: node.properties,
      };
      const result = NodeSchema.safeParse(candidate);
      if (!result.success) {
        violations.push({
          tempId: node.tempId,
          code: "ERR_SCHEMA_INVALID",
          message: `The '${node.type}' node failed schema validation.`,
          details: result.error.issues.map((iss) => ({
            field: iss.path.join("."),
            issue: iss.message,
          })),
        });
        return;
      }
      // Security: this batch path bypasses NodesService -> apply secret guard here
      // too (otherwise IsSecret=true + plaintext DefaultValue writes at-rest plaintext).
      try {
        assertNoPlaintextSecret(node.type, node.properties as Record<string, unknown>);
      } catch {
        violations.push({
          tempId: node.tempId,
          code: "ERR_SECRET_PLAINTEXT",
          message: "When IsSecret=true, DefaultValue (plain-text secret) cannot be stored; use a secret manager/env binding.",
        });
        return;
      }
      idMap[node.tempId] = id;
      nodeMap.set(node.tempId, {
        id,
        type: node.type as NodeKind,
        projectId,
        positionX: candidate.position.x,
        positionY: candidate.position.y,
        homeTabId,
        createdAt: now,
        updatedAt: now,
        version: 1,
        properties: node.properties as Record<string, unknown>,
      });
    });

    // ── 3. name uniqueness (in-batch + DB) ────────────────────────
    await this.checkNames(projectId, nodeMap, violations);

    // ── 4. resolve existing cloud nodes (edge endpoints sourceId/targetId) ──
    const existingNodes = new Map<string, StoredNode>();
    const referencedIds = new Set<string>();
    for (const e of edges) {
      if (e.sourceId) referencedIds.add(e.sourceId);
      if (e.targetId) referencedIds.add(e.targetId);
    }
    for (const id of referencedIds) {
      const stored = await this.nodesRepo.getById(projectId, id);
      if (stored) existingNodes.set(id, stored);
    }

    // ── 5. edge validation + Rules Engine ──────────────────────────────
    const resolveEndpoint = (tempId?: string, cloudId?: string) =>
      tempId ? nodeMap.get(tempId) : existingNodes.get(cloudId!);

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const src = resolveEndpoint(edge.sourceTempId, edge.sourceId);
      const tgt = resolveEndpoint(edge.targetTempId, edge.targetId);
      if (!src) {
        violations.push(
          edge.sourceTempId
            ? { edgeIndex: i, code: "ERR_EDGE_TEMP_NOT_FOUND", message: `sourceTempId '${edge.sourceTempId}' not found in the batch.` }
            : { edgeIndex: i, code: "ERR_EDGE_NODE_NOT_FOUND", message: `Source node '${edge.sourceId}' not found in this project.` },
        );
        continue;
      }
      if (!tgt) {
        violations.push(
          edge.targetTempId
            ? { edgeIndex: i, code: "ERR_EDGE_TEMP_NOT_FOUND", message: `targetTempId '${edge.targetTempId}' not found in the batch.` }
            : { edgeIndex: i, code: "ERR_EDGE_NODE_NOT_FOUND", message: `Target node '${edge.targetId}' not found in this project.` },
        );
        continue;
      }
      if (src.id === tgt.id) {
        violations.push({ edgeIndex: i, code: "ERR_EDGE_SELF_LOOP", message: "A node cannot connect to itself." });
        continue;
      }
      const evaluation = await this.rulesEngine.evaluate({
        projectId,
        sourceNode: src,
        targetNode: tgt,
        edgeKind: edge.edgeType,
      });
      if (!evaluation.allowed) {
        violations.push({
          edgeIndex: i,
          source: { tempId: edge.sourceTempId, id: edge.sourceId, type: src.type },
          target: { tempId: edge.targetTempId, id: edge.targetId, type: tgt.type },
          attemptedEdgeType: edge.edgeType,
          code: evaluation.code ?? "ERR_RULES_DENIED",
          message: evaluation.message ?? "The connection violates the rules.",
          suggestion: evaluation.suggestion,
        });
      }
    }

    // ── 6. in-batch circular dependency (CALLS) ──────────────────────
    const cycle = detectBatchCycle(edges, nodeMap);
    if (cycle) {
      violations.push({
        code: "ERR_COND_001",
        message: `Circular dependency within the batch: ${cycle.join(" → ")}. This leads to an infinite loop (Stack Overflow).`,
        suggestion: "Break the cycle event-driven with an Orchestrator (Saga) or a MessageQueue.",
      });
    }

    // ── 7. rollback on violations (no commit) ──────────────────────
    if (violations.length > 0) {
      return {
        success: false,
        transactionStatus: "ROLLED_BACK",
        message: "The architecture graph has violations blocked by the Rules Engine. No changes were saved.",
        violations,
      };
    }

    // Empty mutation = no-op: return current revision without bump (idempotent).
    if (nodes.length === 0 && edges.length === 0) {
      const graphRevision = await this.projectsRepo.getGraphRevision(projectId);
      return { success: true, idMap, nodeCount: 0, edgeCount: 0, graphRevision };
    }

    // ── 8. atomic commit (single transaction, revision check + bump included) ──
    const graphRevision = await this.commit(projectId, nodes, edges, nodeMap, idMap, now, input.baseRevision);

    return {
      success: true,
      idMap,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      graphRevision,
    };
  }

  private revisionConflict(baseRevision: number, currentRevision: number): ConflictException {
    return new ConflictException({
      code: "ERR_GRAPH_REVISION_CONFLICT",
      message: `The graph was modified since revision ${baseRevision} (current: ${currentRevision}). Pull the latest graph, recompute the delta and retry.`,
      currentRevision,
    });
  }

  private async checkNames(
    projectId: string,
    nodeMap: Map<string, StoredNode>,
    violations: ApplyViolation[],
  ): Promise<void> {
    const batchNames = new Set<string>();
    for (const [tempId, node] of nodeMap.entries()) {
      const nameKey = this.nodesRepo.findNameKey(node.type);
      const name = (node.properties as Record<string, unknown>)[nameKey] as string | undefined;
      if (!name) continue;
      // in-batch
      if (batchNames.has(name)) {
        violations.push({ tempId, code: "ERR_NAME_DUPLICATE", message: `The name '${name}' is used by more than one node in the batch.` });
        continue;
      }
      batchNames.add(name);
      // DB
      const collision = await this.nodesRepo.findByName(projectId, name);
      if (collision) {
        violations.push({ tempId, code: "ERR_NAME_DUPLICATE", message: `The name '${name}' is already in use in this project.` });
      }
    }
  }

  /** Single transaction: revision check (when baseRevision given) + bump,
   *  node create, edge merge. Returns graphRevision after commit. */
  private async commit(
    projectId: string,
    nodes: ApplyGraphInput["mutations"]["nodes"],
    edges: ApplyGraphInput["mutations"]["edges"],
    nodeMap: Map<string, StoredNode>,
    idMap: Record<string, string>,
    now: string,
    baseRevision?: number,
  ): Promise<number> {
    const nodeParams = nodes.map((n) => {
      const stored = nodeMap.get(n.tempId)!;
      return {
        kind: stored.type,
        props: {
          id: stored.id,
          projectId,
          positionX: stored.positionX,
          positionY: stored.positionY,
          homeTabId: stored.homeTabId,
          version: 1, // consistent with HTTP create path (optimistic concurrency)
          properties: JSON.stringify(stored.properties),
        },
        createdAt: now,
        updatedAt: now,
      };
    });

    const edgeParams = edges.map((e) => ({
      sourceId: e.sourceTempId ? idMap[e.sourceTempId] : e.sourceId!,
      targetId: e.targetTempId ? idMap[e.targetTempId] : e.targetId!,
      kind: e.edgeType,
      props: {
        id: randomUUID(),
        projectId,
        kind: e.edgeType,
        properties: JSON.stringify({ IsAsync: false, ...(e.label ? { Label: e.label } : {}) }),
      },
      createdAt: now,
      updatedAt: now,
    }));

    return this.neo4j.write(async (tx) => {
      // Atomic revision check + bump: when baseRevision given and another write
      // slipped in before this transaction, returns 0 rows -> rollback with 409.
      const revResult = await tx.run(
        `MATCH (p:Project {id: $projectId})
         WITH p, coalesce(p.graphRevision, 0) AS rev
         WHERE $baseRevision IS NULL OR rev = $baseRevision
         SET p.graphRevision = rev + 1
         RETURN p.graphRevision AS rev`,
        { projectId, baseRevision: baseRevision ?? null },
      );
      if (baseRevision !== undefined && revResult.records.length === 0) {
        const current = await this.projectsRepo.getGraphRevision(projectId);
        throw this.revisionConflict(baseRevision, current);
      }

      await tx.run(
        `UNWIND $nodes AS nd
         CALL apoc.create.node(['Node', nd.kind], nd.props) YIELD node
         SET node.createdAt = datetime(nd.createdAt), node.updatedAt = datetime(nd.updatedAt)
         RETURN count(node)`,
        { nodes: nodeParams },
      );
      if (edgeParams.length > 0) {
        // apoc.merge.relationship -> does not create same (source, target, kind, projectId)
        // edge twice (idempotent push). props applied only on create.
        await tx.run(
          `UNWIND $edges AS ed
           MATCH (s:Node {id: ed.sourceId}), (t:Node {id: ed.targetId})
           CALL apoc.merge.relationship(s, ed.kind, {projectId: ed.props.projectId}, ed.props, t, {}) YIELD rel
           SET rel.createdAt = coalesce(rel.createdAt, datetime(ed.createdAt)),
               rel.updatedAt = coalesce(rel.updatedAt, datetime(ed.updatedAt))
           RETURN count(rel)`,
          { edges: edgeParams },
        );
      }

      const rev = revResult.records[0]?.get("rev");
      return rev == null ? 0 : Number(rev);
    });
  }
}

function gridPosition(index: number): { x: number; y: number } {
  return { x: (index % GRID_COLS) * GRID_X, y: Math.floor(index / GRID_COLS) * GRID_Y };
}

/** Is there a cycle in CALLS edges within the batch? Returns the chain if so. */
function detectBatchCycle(
  edges: ApplyGraphInput["mutations"]["edges"],
  nodeMap: Map<string, StoredNode>,
): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.edgeType !== "CALLS") continue;
    // Only in-batch (tempId<->tempId) CALLS chains — edges to existing cloud nodes
    // merge into DB graph, excluded from batch cycle analysis.
    if (!e.sourceTempId || !e.targetTempId) continue;
    if (!nodeMap.has(e.sourceTempId) || !nodeMap.has(e.targetTempId)) continue;
    if (!adj.has(e.sourceTempId)) adj.set(e.sourceTempId, []);
    adj.get(e.sourceTempId)!.push(e.targetTempId);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  const dfs = (node: string): string[] | null => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        // cycle — extract chain from stack
        const idx = stack.indexOf(next);
        return [...stack.slice(idx), next];
      }
      if (c === WHITE) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  };

  for (const node of adj.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      const found = dfs(node);
      if (found) return found;
    }
  }
  return null;
}
