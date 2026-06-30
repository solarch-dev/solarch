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
  /** Optimistic concurrency: verilirse yalnız bu version'daki node güncellenir
   *  (atomik). Uyuşmazsa 0 kayıt döner (TOCTOU race backstop). */
  expectedVersion?: number;
}

const NAME_KEYS_BY_KIND: Record<NodeKind, string> = {
  // Veri
  Table: "TableName",
  DTO: "Name",
  Model: "ClassName",
  Enum: "Name",
  View: "ViewName",
  // İş Mantığı
  Service: "ServiceName",
  Worker: "WorkerName",
  EventHandler: "HandlerName",
  // Erişim
  Controller: "ControllerName",
  MessageQueue: "QueueName",
  // Altyapı
  Repository: "RepositoryName",
  Cache: "CacheName",
  ExternalService: "ServiceName",
  // İstemci
  FrontendApp: "AppName",
  UIComponent: "ComponentName",
  // Güvenlik
  Middleware: "MiddlewareName",
  // Konfigürasyon
  EnvironmentVariable: "Key",
  Exception: "ExceptionName",
  // Yapı
  Module: "ModuleName",
  // Phase 2A ek tipler
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

    // expectedVersion verilirse atomik guard: yalnız o version eşleşirse güncelle.
    // coalesce(n.version,1): migration öncesi version'suz node'ları 1 say (frontend default'u ile uyumlu).
    // Her başarılı update version'u +1 yapar. 0 kayıt → bulunamadı VEYA version uyuşmadı (service ayırır).
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
    // Tüm name field varyantlarını OR ile dolaş — proje içi global unique.
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
