import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../neo4j/neo4j.service";
import type { StoredTab, TabGraph, TabGraphMember, TabGraphEdge } from "./schemas/tab.schema";

@Injectable()
export class TabsRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async projectExists(projectId: string): Promise<boolean> {
    const r = await this.neo4j.run(`MATCH (p:Project {id: $projectId}) RETURN p LIMIT 1`, { projectId });
    return r.records.length > 0;
  }

  async nodeExists(projectId: string, nodeId: string): Promise<boolean> {
    const r = await this.neo4j.run(
      `MATCH (n:Node {id: $nodeId, projectId: $projectId}) RETURN n LIMIT 1`,
      { projectId, nodeId },
    );
    return r.records.length > 0;
  }

  async nodeHomeTab(projectId: string, nodeId: string): Promise<string | null> {
    const r = await this.neo4j.run(
      `MATCH (n:Node {id: $nodeId, projectId: $projectId}) RETURN n.homeTabId AS h`,
      { projectId, nodeId },
    );
    return r.records.length ? (r.records[0].get("h") ?? null) : null;
  }

  async create(tab: StoredTab): Promise<void> {
    await this.neo4j.run(
      `CREATE (t:Tab {
        id: $id, projectId: $projectId, name: $name, isDefault: $isDefault,
        order: $order, moduleNodeId: $moduleNodeId,
        createdAt: datetime($createdAt), updatedAt: datetime($updatedAt)
      })`,
      { ...tab, moduleNodeId: tab.moduleNodeId ?? null },
    );
  }

  async list(projectId: string): Promise<StoredTab[]> {
    const r = await this.neo4j.run(
      `MATCH (t:Tab {projectId: $projectId}) RETURN t ORDER BY t.order ASC`,
      { projectId },
    );
    return r.records.map((rec) => toStoredTab(rec.get("t").properties));
  }

  async getById(projectId: string, tabId: string): Promise<StoredTab | null> {
    const r = await this.neo4j.run(
      `MATCH (t:Tab {id: $tabId, projectId: $projectId}) RETURN t`,
      { projectId, tabId },
    );
    return r.records.length ? toStoredTab(r.records[0].get("t").properties) : null;
  }

  async findDefault(projectId: string): Promise<StoredTab | null> {
    const r = await this.neo4j.run(
      `MATCH (t:Tab {projectId: $projectId, isDefault: true}) RETURN t LIMIT 1`,
      { projectId },
    );
    return r.records.length ? toStoredTab(r.records[0].get("t").properties) : null;
  }

  async maxOrder(projectId: string): Promise<number> {
    const r = await this.neo4j.run(
      `MATCH (t:Tab {projectId: $projectId}) RETURN coalesce(max(t.order), -1) AS m`,
      { projectId },
    );
    return Number(r.records[0].get("m"));
  }

  async update(
    projectId: string,
    tabId: string,
    patch: { name?: string; order?: number; updatedAt: string },
  ): Promise<StoredTab | null> {
    const sets: string[] = ["t.updatedAt = datetime($updatedAt)"];
    if (patch.name !== undefined) sets.push("t.name = $name");
    if (patch.order !== undefined) sets.push("t.order = $order");
    const r = await this.neo4j.run(
      `MATCH (t:Tab {id: $tabId, projectId: $projectId}) SET ${sets.join(", ")} RETURN t`,
      { projectId, tabId, name: patch.name ?? null, order: patch.order ?? null, updatedAt: patch.updatedAt },
    );
    return r.records.length ? toStoredTab(r.records[0].get("t").properties) : null;
  }

  /** Sekmeyi sil: owned node'ların evini default'a taşı + tab'ı (ve REFERENCES'larını)
   *  sil. **Tek atomik sorgu** — önceden 3 ayrı transaction'dı; ortada crash olursa
   *  yarım durum (taşınmış node ama silinmemiş tab / dangling REFERENCES) kalıyordu.
   *  `DETACH DELETE` tab'ın tüm ilişkilerini (REFERENCES dahil) temizler; `count(n)`
   *  satırları tek'e indirir (aksi halde her owned node için DELETE tekrar eder). */
  async deleteAndReassign(projectId: string, tabId: string, defaultTabId: string): Promise<void> {
    await this.neo4j.run(
      `OPTIONAL MATCH (n:Node {projectId: $projectId, homeTabId: $tabId})
       SET n.homeTabId = $defaultTabId
       WITH count(n) AS reassigned
       MATCH (t:Tab {id: $tabId, projectId: $projectId})
       DETACH DELETE t`,
      { projectId, tabId, defaultTabId },
    );
  }

  /** Referans ekle/güncelle (upsert). */
  async upsertReference(projectId: string, tabId: string, nodeId: string, x: number, y: number): Promise<void> {
    await this.neo4j.run(
      `MATCH (t:Tab {id: $tabId, projectId: $projectId})
       MATCH (n:Node {id: $nodeId, projectId: $projectId})
       MERGE (t)-[r:REFERENCES]->(n)
       SET r.x = $x, r.y = $y`,
      { projectId, tabId, nodeId, x, y },
    );
  }

  async removeReference(projectId: string, tabId: string, nodeId: string): Promise<boolean> {
    const r = await this.neo4j.run(
      `MATCH (t:Tab {id: $tabId, projectId: $projectId})-[r:REFERENCES]->(n:Node {id: $nodeId})
       DELETE r RETURN 1 AS d`,
      { projectId, tabId, nodeId },
    );
    return r.records.length > 0;
  }

  /** Toplu layout kaydet: owned → node.positionX/Y, referenced → REFERENCES.x/y. */
  async saveLayout(projectId: string, tabId: string, items: { nodeId: string; x: number; y: number }[]): Promise<void> {
    await this.neo4j.run(
      `UNWIND $items AS item
       MATCH (n:Node {id: item.nodeId, projectId: $projectId})
       FOREACH (_ IN CASE WHEN n.homeTabId = $tabId THEN [1] ELSE [] END |
         SET n.positionX = item.x, n.positionY = item.y)
       WITH n, item
       OPTIONAL MATCH (t:Tab {id: $tabId, projectId: $projectId})-[r:REFERENCES]->(n)
       FOREACH (_ IN CASE WHEN r IS NOT NULL THEN [1] ELSE [] END |
         SET r.x = item.x, r.y = item.y)`,
      { projectId, tabId, items },
    );
  }

  /** Sekmenin render içeriği: owned (homeTabId=tab) + referenced node'lar + iki ucu da
   *  görünen edge'ler. */
  async tabGraph(projectId: string, tab: StoredTab): Promise<TabGraph> {
    const ownedRes = await this.neo4j.run(
      `MATCH (n:Node {projectId: $projectId, homeTabId: $tabId}) RETURN n, labels(n) AS labels`,
      { projectId, tabId: tab.id },
    );
    const owned: TabGraphMember[] = ownedRes.records.map((rec) =>
      memberFrom(rec.get("n").properties, rec.get("labels"), false),
    );

    const refRes = await this.neo4j.run(
      `MATCH (:Tab {id: $tabId, projectId: $projectId})-[r:REFERENCES]->(n:Node)
       RETURN n, labels(n) AS labels, r.x AS x, r.y AS y`,
      { projectId, tabId: tab.id },
    );
    const referenced: TabGraphMember[] = refRes.records.map((rec) => {
      const m = memberFrom(rec.get("n").properties, rec.get("labels"), true);
      m.position = { x: Number(rec.get("x")), y: Number(rec.get("y")) };
      return m;
    });

    const members = [...owned, ...referenced];
    const visibleIds = members.map((m) => m.id);

    const edgesRes = await this.neo4j.run(
      `MATCH (s:Node)-[e]->(t:Node)
       WHERE e.projectId = $projectId AND s.id IN $ids AND t.id IN $ids
       RETURN e.id AS id, type(e) AS kind, s.id AS sourceNodeId, t.id AS targetNodeId`,
      { projectId, ids: visibleIds },
    );
    const edges: TabGraphEdge[] = edgesRes.records.map((rec) => ({
      id: rec.get("id"),
      kind: rec.get("kind"),
      sourceNodeId: rec.get("sourceNodeId"),
      targetNodeId: rec.get("targetNodeId"),
    }));

    return { tab, nodes: members, edges };
  }
}

function toStoredTab(p: any): StoredTab {
  return {
    id: p.id,
    projectId: p.projectId,
    name: p.name,
    isDefault: p.isDefault,
    order: Number(p.order),
    moduleNodeId: p.moduleNodeId ?? undefined,
    createdAt: new Date(p.createdAt).toISOString(),
    updatedAt: new Date(p.updatedAt).toISOString(),
  };
}

function memberFrom(p: any, labels: string[], isReference: boolean): TabGraphMember {
  const kind = labels.find((l: string) => l !== "Node") as string;
  return {
    id: p.id,
    type: kind,
    properties: JSON.parse(p.properties),
    position: { x: Number(p.positionX), y: Number(p.positionY) },
    version: Number(p.version ?? 1),
    isReference,
    origin: isReference ? p.homeTabId : undefined,
    // İmplementasyon sayaçları — hiç rapor edilmediyse alanlar görünmez.
    ...(p.implTotal != null
      ? {
          implTotal: Number(p.implTotal),
          implFilled: Number(p.implFilled ?? 0),
          implAi: Number(p.implAi ?? 0),
        }
      : {}),
  };
}
