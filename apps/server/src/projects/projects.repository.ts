import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../neo4j/neo4j.service";
import type { ProjectStatus } from "./schemas/project.schema";
import type { Node, NodeKind } from "../nodes/schemas";
import { redactNodeSecrets } from "../nodes/secret-redaction";
import type { Edge, EdgeKind } from "../edges/schemas/edge.schema";

export interface StoredProject {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  ownerId: string;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  updatedAt: string;
}

@Injectable()
export class ProjectsRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async create(p: StoredProject): Promise<void> {
    await this.neo4j.run(
      `CREATE (p:Project {
        id: $id, name: $name, description: $description, status: $status,
        ownerId: $ownerId, orgId: $orgId,
        createdAt: datetime($createdAt), updatedAt: datetime($updatedAt)
      })`,
      {
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        ownerId: p.ownerId,
        orgId: p.orgId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
    );
  }

  async getById(id: string): Promise<StoredProject | null> {
    const result = await this.neo4j.run(`MATCH (p:Project {id: $id}) RETURN p`, { id });
    if (result.records.length === 0) return null;
    return toStoredProject(result.records[0].get("p"));
  }

  /** Projects in caller scope: org's projects when org active, otherwise
   *  personal (ownerId match and not org-owned) projects. */
  async list(scope: { userId: string; orgId: string | null }): Promise<StoredProject[]> {
    const cypher = scope.orgId
      ? `MATCH (p:Project) WHERE p.orgId = $orgId RETURN p ORDER BY p.createdAt DESC`
      : `MATCH (p:Project) WHERE p.ownerId = $userId AND p.orgId IS NULL RETURN p ORDER BY p.createdAt DESC`;
    const result = await this.neo4j.run(cypher, { orgId: scope.orgId, userId: scope.userId });
    return result.records.map((r) => toStoredProject(r.get("p")));
  }

  async update(id: string, update: ProjectUpdate): Promise<StoredProject | null> {
    const partial: Record<string, unknown> = { updatedAt: update.updatedAt };
    if (update.name !== undefined) partial.name = update.name;
    if (update.description !== undefined) partial.description = update.description;
    if (update.status !== undefined) partial.status = update.status;

    const result = await this.neo4j.run(
      `MATCH (p:Project {id: $id})
       SET p += $partial, p.updatedAt = datetime($updatedAt)
       RETURN p`,
      { id, partial, updatedAt: update.updatedAt },
    );
    if (result.records.length === 0) return null;
    return toStoredProject(result.records[0].get("p"));
  }

  /** Cascade delete: project + all nodes + edges (DETACH). */
  async delete(id: string): Promise<boolean> {
    const result = await this.neo4j.run(
      `MATCH (p:Project {id: $id})
       WITH p
       OPTIONAL MATCH (n:Node {projectId: $id})
       DETACH DELETE n
       WITH p
       DETACH DELETE p
       RETURN 1 AS deleted`,
      { id },
    );
    return result.records.length > 0;
  }

  async exists(id: string): Promise<boolean> {
    const result = await this.neo4j.run(
      `MATCH (p:Project {id: $id}) RETURN p LIMIT 1`,
      { id },
    );
    return result.records.length > 0;
  }

  /** Reassign ownership (e.g. admin transfer). */
  async reassignOwner(id: string, ownerId: string, orgId: string | null): Promise<void> {
    await this.neo4j.run(
      `MATCH (p:Project {id: $id})
       SET p.ownerId = $ownerId, p.orgId = $orgId, p.updatedAt = datetime($now)`,
      { id, ownerId, orgId, now: new Date().toISOString() },
    );
  }

  /** Read Constructor version stamped on project.
   *  No project -> undefined; project exists but never codegen'd -> null
   *  ("not yet generated"); otherwise stamped integer. */
  async getCodegenVersion(id: string): Promise<number | null | undefined> {
    const result = await this.neo4j.run(
      `MATCH (p:Project {id: $id}) RETURN p.codegenVersion AS v`,
      { id },
    );
    if (result.records.length === 0) return undefined; // no project
    const v = result.records[0].get("v");
    return v == null ? null : Number(v); // Neo4j Integer -> number
  }

  /** After successful codegen, stamp Constructor version + graphRevision AT GENERATION TIME
   *  on project node. Second is for drift ("did diagram change after generation"):
   *  status reports drift when codegenGraphRevision < graphRevision.
   *  Stored as int via toInteger() (not float). */
  async setCodegenVersion(id: string, version: number): Promise<void> {
    await this.neo4j.run(
      `MATCH (p:Project {id: $id})
       SET p.codegenVersion = toInteger($version),
           p.codegenGraphRevision = coalesce(p.graphRevision, 0)`,
      { id, version },
    );
  }

  /** graphRevision stamped at generation time — for drift calculation. null if never generated. */
  async getCodegenGraphRevision(id: string): Promise<number | null> {
    const result = await this.neo4j.run(
      `MATCH (p:Project {id: $id}) RETURN p.codegenGraphRevision AS rev`,
      { id },
    );
    if (result.records.length === 0) return null;
    const v = result.records[0].get("rev");
    return v == null ? null : Number(v);
  }

  /** Persisted Simple-View model (the AI-enriched diagram) so it survives restarts and is reused
   *  until the graph changes. Keyed by the deterministic baseline hash; only AI results are stored
   *  (the deterministic baseline is recomputed instantly, nothing to persist). Returns null if none
   *  is stored or the stored JSON is unreadable. NOTE: stored as a property on the Project node;
   *  toStoredProject picks named fields, so this never bloats the project DTO. */
  async getSimpleSketchModel<T>(id: string): Promise<{ key: string; model: T } | null> {
    const result = await this.neo4j.run(
      `MATCH (p:Project {id: $id}) RETURN p.simpleSketchKey AS key, p.simpleSketchJson AS json`,
      { id },
    );
    if (result.records.length === 0) return null;
    const key = result.records[0].get("key");
    const json = result.records[0].get("json");
    if (key == null || json == null) return null;
    try { return { key: String(key), model: JSON.parse(String(json)) as T }; }
    catch { return null; } // corrupt/legacy payload -> treat as no cache (regenerate)
  }

  /** Persist the AI-enriched Simple-View model for a project (overwrites any previous one). */
  async setSimpleSketchModel(id: string, key: string, model: unknown): Promise<void> {
    await this.neo4j.run(
      `MATCH (p:Project {id: $id})
       SET p.simpleSketchKey = $key, p.simpleSketchJson = $json`,
      { id, key, json: JSON.stringify(model) },
    );
  }

  /** Persisted AI-enriched OpenAPI doc (the "AI Documentize" result) so it survives restarts and is
   *  reused until the graph changes. Keyed by the deterministic baseline hash; only AI results are
   *  stored (the deterministic baseline is recomputed instantly, nothing to persist). Returns null if
   *  none is stored or the stored JSON is unreadable. Mirrors getSimpleSketchModel — stored as named
   *  fields on the Project node, so toStoredProject never bloats the project DTO. */
  async getOpenApiDoc<T>(id: string): Promise<{ key: string; doc: T } | null> {
    const result = await this.neo4j.run(
      `MATCH (p:Project {id: $id}) RETURN p.openApiKey AS key, p.openApiJson AS json`,
      { id },
    );
    if (result.records.length === 0) return null;
    const key = result.records[0].get("key");
    const json = result.records[0].get("json");
    if (key == null || json == null) return null;
    try { return { key: String(key), doc: JSON.parse(String(json)) as T }; }
    catch { return null; } // corrupt/legacy payload -> treat as no cache (regenerate)
  }

  /** Persist the AI-enriched OpenAPI doc for a project (overwrites any previous one). */
  async setOpenApiDoc(id: string, key: string, doc: unknown): Promise<void> {
    await this.neo4j.run(
      `MATCH (p:Project {id: $id})
       SET p.openApiKey = $key, p.openApiJson = $json`,
      { id, key, json: JSON.stringify(doc) },
    );
  }

  /** Increments graph revision counter by +1 and returns new value. Called on structural
   *  mutations (node/edge create-update-delete, graph/apply); position/tab layout save
   *  does NOT call (avoids drift, unnecessary conflicts). */
  async bumpRevision(id: string): Promise<number> {
    const result = await this.neo4j.run(
      `MATCH (p:Project {id: $id})
       SET p.graphRevision = coalesce(p.graphRevision, 0) + 1
       RETURN p.graphRevision AS rev`,
      { id },
    );
    if (result.records.length === 0) return 0;
    return Number(result.records[0].get("rev"));
  }

  async getGraphRevision(id: string): Promise<number> {
    const result = await this.neo4j.run(
      `MATCH (p:Project {id: $id}) RETURN coalesce(p.graphRevision, 0) AS rev`,
      { id },
    );
    if (result.records.length === 0) return 0;
    return Number(result.records[0].get("rev"));
  }

  /** Write implementation counters to nodes (CLI/extension report).
   *  NOT structural mutation: graphRevision not bumped, version not incremented.
   *  Unknown nodeIds silently skipped (MATCH misses). */
  async setImplementation(
    projectId: string,
    entries: { nodeId: string; total: number; filled: number; filledAi: number }[],
  ): Promise<number> {
    const result = await this.neo4j.run(
      `UNWIND $entries AS e
       MATCH (n:Node {projectId: $projectId, id: e.nodeId})
       SET n.implTotal = e.total, n.implFilled = e.filled, n.implAi = e.filledAi,
           n.implAt = datetime()
       RETURN count(n) AS updated`,
      { projectId, entries },
    );
    if (result.records.length === 0) return 0;
    return Number(result.records[0].get("updated"));
  }

  async counts(id: string): Promise<{ nodes: number; edges: number }> {
    const result = await this.neo4j.run(
      `OPTIONAL MATCH (n:Node {projectId: $id})
       WITH count(n) AS nodeCount
       OPTIONAL MATCH ()-[r]->() WHERE r.projectId = $id
       RETURN nodeCount, count(r) AS edgeCount`,
      { id },
    );
    const rec = result.records[0];
    return {
      nodes: Number(rec.get("nodeCount")),
      edges: Number(rec.get("edgeCount")),
    };
  }

  /** Returns all project nodes + edges in domain format. */
  async getGraph(id: string): Promise<{ nodes: Node[]; edges: Edge[] }> {
    const nodesResult = await this.neo4j.run(
      `MATCH (n:Node {projectId: $id}) RETURN n, labels(n) AS labels`,
      { id },
    );
    const nodes = nodesResult.records.map((r) => nodeFromRecord(r.get("n"), r.get("labels")));

    const edgesResult = await this.neo4j.run(
      `MATCH (s:Node)-[r]->(t:Node)
       WHERE r.projectId = $id
       RETURN r, type(r) AS kind, s.id AS sourceId, t.id AS targetId`,
      { id },
    );
    const edges = edgesResult.records.map((r) =>
      edgeFromRecord(r.get("r"), r.get("kind"), r.get("sourceId"), r.get("targetId")),
    );

    return { nodes, edges };
  }
}

function toStoredProject(p: any): StoredProject {
  return {
    id: p.properties.id,
    name: p.properties.name,
    description: p.properties.description,
    status: p.properties.status,
    ownerId: p.properties.ownerId ?? "",
    orgId: p.properties.orgId ?? null,
    createdAt: new Date(p.properties.createdAt).toISOString(),
    updatedAt: new Date(p.properties.updatedAt).toISOString(),
  };
}

function nodeFromRecord(n: any, labels: string[]): Node {
  const props = n.properties;
  const kind = labels.find((l: string) => l !== "Node") as NodeKind;
  return {
    id: props.id,
    type: kind,
    projectId: props.projectId,
    position: { x: Number(props.positionX), y: Number(props.positionY) },
    homeTabId: props.homeTabId,
    createdAt: new Date(props.createdAt).toISOString(),
    updatedAt: new Date(props.updatedAt).toISOString(),
    version: Number(props.version ?? 1),
    // Implementation counters — fields omitted when never reported.
    ...(props.implTotal != null
      ? {
          implTotal: Number(props.implTotal),
          implFilled: Number(props.implFilled ?? 0),
          implAi: Number(props.implAi ?? 0),
        }
      : {}),
    properties: redactNodeSecrets(kind, JSON.parse(props.properties)),
  } as Node;
}

function edgeFromRecord(r: any, kind: string, sourceId: string, targetId: string): Edge {
  return {
    id: r.properties.id,
    projectId: r.properties.projectId,
    sourceNodeId: sourceId,
    targetNodeId: targetId,
    kind: kind as EdgeKind,
    createdAt: new Date(r.properties.createdAt).toISOString(),
    updatedAt: new Date(r.properties.updatedAt).toISOString(),
    properties: JSON.parse(r.properties.properties),
  };
}
