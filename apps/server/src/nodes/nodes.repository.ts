import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../neo4j/neo4j.service";
import type { NodeKind } from "./schemas";

export interface StoredNode {
  id: string;
  type: NodeKind;
  projectId: string;
  positionX: number;
  positionY: number;
  homeTabId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  properties: Record<string, unknown>;
}

export interface NodeUpdate {
  positionX?: number;
  positionY?: number;
  properties?: Record<string, unknown>;
  updatedAt: string;
  /** Optimistic concurrency: when given, only updates node at this version
   *  (atomic). Mismatch returns 0 rows (TOCTOU race backstop). */
  expectedVersion?: number;
}

const NAME_KEYS_BY_KIND: Record<NodeKind, string> = {
  // Data
  Table: "TableName",
  DTO: "Name",
  Model: "ClassName",
  Enum: "Name",
  View: "ViewName",
  // Business Logic
  Service: "ServiceName",
  Worker: "WorkerName",
  EventHandler: "HandlerName",
  // Access
  Controller: "ControllerName",
  MessageQueue: "QueueName",
  // Infrastructure
  Repository: "RepositoryName",
  Cache: "CacheName",
  ExternalService: "ServiceName",
  // Client
  FrontendApp: "AppName",
  UIComponent: "ComponentName",
  // Security
  Middleware: "MiddlewareName",
  // Configuration
  EnvironmentVariable: "Key",
  Exception: "ExceptionName",
  // Structure
  Module: "ModuleName",
  // Phase 2A additional types
  APIGateway: "GatewayName",
  Orchestrator: "OrchestratorName",
};

@Injectable()
export class NodesRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async create(node: StoredNode): Promise<void> {
    const cypher = `
      CREATE (n:Node:${node.type} {
        id: $id, projectId: $projectId,
        positionX: $positionX, positionY: $positionY, homeTabId: $homeTabId,
        createdAt: datetime($createdAt), updatedAt: datetime($updatedAt),
        version: 1,
        properties: $properties
      })
    `;
    await this.neo4j.run(cypher, {
      id: node.id,
      projectId: node.projectId,
      positionX: node.positionX,
      positionY: node.positionY,
      homeTabId: node.homeTabId,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      properties: JSON.stringify(node.properties),
    });
  }

  async getById(projectId: string, id: string): Promise<StoredNode | null> {
    const result = await this.neo4j.run(
      `MATCH (n:Node {id: $id, projectId: $projectId}) RETURN n, labels(n) AS labels`,
      { id, projectId },
    );
    if (result.records.length === 0) return null;
    return toStoredNode(result.records[0].get("n"), result.records[0].get("labels"));
  }

  async list(projectId: string, kind?: NodeKind): Promise<StoredNode[]> {
    const cypher = kind
      ? `MATCH (n:Node:${kind} {projectId: $projectId}) RETURN n, labels(n) AS labels`
      : `MATCH (n:Node {projectId: $projectId}) RETURN n, labels(n) AS labels`;
    const result = await this.neo4j.run(cypher, { projectId });
    return result.records.map((r) => toStoredNode(r.get("n"), r.get("labels")));
  }

  async update(projectId: string, id: string, update: NodeUpdate): Promise<StoredNode | null> {
    const partial: Record<string, unknown> = {};
    if (update.positionX !== undefined) partial.positionX = update.positionX;
    if (update.positionY !== undefined) partial.positionY = update.positionY;
    if (update.properties !== undefined) partial.properties = JSON.stringify(update.properties);

    // When expectedVersion is given, atomic guard: update only if version matches.
    // coalesce(n.version,1): treat pre-migration nodes without version as 1 (matches frontend default).
    // Each successful update increments version by +1. 0 rows -> not found OR version mismatch (service distinguishes).
    const result = await this.neo4j.run(
      `MATCH (n:Node {id: $id, projectId: $projectId})
       WHERE $expectedVersion IS NULL OR coalesce(n.version, 1) = $expectedVersion
       SET n += $partial, n.updatedAt = datetime($updatedAt), n.version = coalesce(n.version, 1) + 1
       RETURN n, labels(n) AS labels`,
      { id, projectId, partial, updatedAt: update.updatedAt, expectedVersion: update.expectedVersion ?? null },
    );
    if (result.records.length === 0) return null;
    return toStoredNode(result.records[0].get("n"), result.records[0].get("labels"));
  }

  async delete(projectId: string, id: string): Promise<boolean> {
    const result = await this.neo4j.run(
      `MATCH (n:Node {id: $id, projectId: $projectId})
       WITH n
       DETACH DELETE n
       RETURN 1 AS deleted`,
      { id, projectId },
    );
    return result.records.length > 0;
  }

  async findByName(projectId: string, name: string): Promise<StoredNode | null> {
    // Walk all name field variants with OR — globally unique within project.
    const result = await this.neo4j.run(
      `MATCH (n:Node {projectId: $projectId})
       WITH n, apoc.convert.fromJsonMap(n.properties) AS props
       WHERE props.TableName = $name
          OR props.Name = $name
          OR props.ClassName = $name
          OR props.ViewName = $name
          OR props.ServiceName = $name
          OR props.WorkerName = $name
          OR props.HandlerName = $name
          OR props.ControllerName = $name
          OR props.QueueName = $name
          OR props.RepositoryName = $name
          OR props.CacheName = $name
          OR props.AppName = $name
          OR props.ComponentName = $name
          OR props.MiddlewareName = $name
          OR props.Key = $name
          OR props.ExceptionName = $name
          OR props.ModuleName = $name
          OR props.GatewayName = $name
          OR props.OrchestratorName = $name
       RETURN n, labels(n) AS labels LIMIT 1`,
      { projectId, name },
    );
    if (result.records.length === 0) return null;
    return toStoredNode(result.records[0].get("n"), result.records[0].get("labels"));
  }

  findNameKey(kind: NodeKind): string {
    return NAME_KEYS_BY_KIND[kind];
  }
}

function toStoredNode(n: any, labels: string[]): StoredNode {
  const props = n.properties;
  const kind = labels.find((l: string) => l !== "Node") as NodeKind;
  return {
    id: props.id,
    type: kind,
    projectId: props.projectId,
    positionX: Number(props.positionX),
    positionY: Number(props.positionY),
    homeTabId: props.homeTabId,
    createdAt: new Date(props.createdAt).toISOString(),
    updatedAt: new Date(props.updatedAt).toISOString(),
    version: Number(props.version ?? 1),
    properties: JSON.parse(props.properties),
  };
}
