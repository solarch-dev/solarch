import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../neo4j/neo4j.service";
import type { EdgeKind, EdgeProperties } from "./schemas/edge.schema";

export interface StoredEdge {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: EdgeKind;
  createdAt: string;
  updatedAt: string;
  properties: EdgeProperties;
}

export interface EdgeFilter {
  kind?: EdgeKind;
  sourceNodeId?: string;
  targetNodeId?: string;
}

@Injectable()
export class EdgesRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  /** Edge yaratır ve **gerçekten kalıcı olan** edge'i döner (race'te eşleşen mevcut
   *  edge dönebilir). `apoc.merge.relationship` ile (source, target, kind) bazında
   *  idempotent → app-katmanı existsBetween kontrolüyle race olsa bile çift edge
   *  oluşmaz. Endpoint'lerden biri yoksa (race: silinmiş) MATCH boş → null döner. */
  async create(edge: StoredEdge): Promise<StoredEdge | null> {
    const result = await this.neo4j.run(
      `MATCH (s:Node {id: $sourceId, projectId: $projectId})
       MATCH (t:Node {id: $targetId, projectId: $projectId})
       CALL apoc.merge.relationship(s, $kind, {}, $onCreateProps, t) YIELD rel
       SET rel.createdAt = coalesce(rel.createdAt, datetime($createdAt)),
           rel.updatedAt = coalesce(rel.updatedAt, datetime($updatedAt))
       RETURN rel AS r, type(rel) AS kind, s.id AS sourceId, t.id AS targetId`,
      {
        sourceId: edge.sourceNodeId,
        targetId: edge.targetNodeId,
        projectId: edge.projectId,
        kind: edge.kind,
        onCreateProps: {
          id: edge.id,
          projectId: edge.projectId,
          kind: edge.kind,
          properties: JSON.stringify(edge.properties),
        },
        createdAt: edge.createdAt,
        updatedAt: edge.updatedAt,
      },
    );
    if (result.records.length === 0) return null;
    return toStoredEdge(result.records[0]);
  }

  async getById(projectId: string, id: string): Promise<StoredEdge | null> {
    const result = await this.neo4j.run(
      `MATCH (s:Node)-[r {id: $id, projectId: $projectId}]->(t:Node)
       RETURN r, type(r) AS kind, s.id AS sourceId, t.id AS targetId`,
      { id, projectId },
    );
    if (result.records.length === 0) return null;
    return toStoredEdge(result.records[0]);
  }

  async list(projectId: string, filter: EdgeFilter = {}): Promise<StoredEdge[]> {
    const where: string[] = ["r.projectId = $projectId"];
    const params: Record<string, unknown> = { projectId };
    if (filter.kind) {
      where.push("type(r) = $kind");
      params.kind = filter.kind;
    }
    if (filter.sourceNodeId) {
      where.push("s.id = $sourceId");
      params.sourceId = filter.sourceNodeId;
    }
    if (filter.targetNodeId) {
      where.push("t.id = $targetId");
      params.targetId = filter.targetNodeId;
    }
    const result = await this.neo4j.run(
      `MATCH (s:Node)-[r]->(t:Node)
       WHERE ${where.join(" AND ")}
       RETURN r, type(r) AS kind, s.id AS sourceId, t.id AS targetId`,
      params,
    );
    return result.records.map((rec) => toStoredEdge(rec));
  }

  async updateProperties(
    projectId: string,
    id: string,
    properties: EdgeProperties,
    updatedAt: string,
  ): Promise<StoredEdge | null> {
    const result = await this.neo4j.run(
      `MATCH (s:Node)-[r {id: $id, projectId: $projectId}]->(t:Node)
       SET r.properties = $properties, r.updatedAt = datetime($updatedAt)
       RETURN r, type(r) AS kind, s.id AS sourceId, t.id AS targetId`,
      { id, projectId, properties: JSON.stringify(properties), updatedAt },
    );
    if (result.records.length === 0) return null;
    return toStoredEdge(result.records[0]);
  }

  async delete(projectId: string, id: string): Promise<boolean> {
    const result = await this.neo4j.run(
      `MATCH ()-[r {id: $id, projectId: $projectId}]->()
       WITH r
       DELETE r
       RETURN 1 AS deleted`,
      { id, projectId },
    );
    return result.records.length > 0;
  }

  /** Source + target node'ların varlığını sorgular (projectId scope'unda). */
  async nodesExist(
    projectId: string,
    sourceId: string,
    targetId: string,
  ): Promise<{ source: boolean; target: boolean }> {
    const result = await this.neo4j.run(
      `OPTIONAL MATCH (s:Node {id: $sourceId, projectId: $projectId})
       OPTIONAL MATCH (t:Node {id: $targetId, projectId: $projectId})
       RETURN s IS NOT NULL AS sourceExists, t IS NOT NULL AS targetExists`,
      { sourceId, targetId, projectId },
    );
    const rec = result.records[0];
    return {
      source: rec.get("sourceExists") as boolean,
      target: rec.get("targetExists") as boolean,
    };
  }

  /** Aynı (source, target, kind) zaten var mı? */
  async existsBetween(
    projectId: string,
    sourceId: string,
    targetId: string,
    kind: EdgeKind,
  ): Promise<boolean> {
    const result = await this.neo4j.run(
      `MATCH (s:Node {id: $sourceId, projectId: $projectId})-[r:\`${kind}\`]->(t:Node {id: $targetId, projectId: $projectId})
       RETURN r LIMIT 1`,
      { sourceId, targetId, projectId },
    );
    return result.records.length > 0;
  }
}

function toStoredEdge(record: any): StoredEdge {
  const r = record.get("r");
  return {
    id: r.properties.id,
    projectId: r.properties.projectId,
    sourceNodeId: record.get("sourceId"),
    targetNodeId: record.get("targetId"),
    kind: record.get("kind") as EdgeKind,
    createdAt: new Date(r.properties.createdAt).toISOString(),
    updatedAt: new Date(r.properties.updatedAt).toISOString(),
    properties: JSON.parse(r.properties.properties),
  };
}
