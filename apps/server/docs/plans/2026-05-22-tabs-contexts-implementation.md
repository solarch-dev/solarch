# Tabs / Contexts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proje içinde çoklu sekme (context) + kutuların sekmeler arası referans (import) ile paylaşımı.

**Architecture:** "Tek ev + referans" modeli. Node tek ev sekmesinde tanımlı (`positionX/Y` korunur + `homeTabId` eklenir). Başka sekmelerde `(:Tab)-[:REFERENCES {x,y}]->(:Node)` ilişkisiyle import. Çoğunlukla additive — node.position korunduğundan apply/AI/CRUD/graph bozulmaz.

**Tech Stack:** NestJS 11, Neo4j 5 (raw Cypher), Zod + nestjs-zod, Vitest + Testcontainers.

**Modül bağımlılık yönü (döngü önleme):** `TabsRepository` SADECE `Neo4jService`'e bağlanır; proje/node varlığını kendi Cypher'ıyla kontrol eder. Böylece `ProjectsModule → TabsModule` ve `NodesModule → TabsModule` tek yönlüdür (TabsModule, Projects/Nodes'tan hiçbir şey import etmez).

**Referans desenler:** `src/projects/projects.repository.ts` (Cypher repo + toStoredX), `src/nodes/nodes.service.ts` (create + existence check), `src/edges/edges.repository.ts` (APOC ilişki), `src/common/envelope.ts` (`ok()`), `src/node-types/node-types.controller.ts` (Scalar decorator), `test/patterns.e2e-spec.ts` (Testcontainers + overrideProvider deseni), `src/neo4j/migrations/data/004-pattern-vector-index.ts` (TS migration).

---

## File Structure

- `src/tabs/schemas/tab.schema.ts` — Zod: Tab, CreateTab, UpdateTab, Reference, Layout + tipler
- `src/tabs/dto/*.dto.ts` — createZodDto sınıfları
- `src/tabs/tabs.repository.ts` — Cypher: tab CRUD + reference + tabGraph + layout + existence
- `src/tabs/tabs.service.ts` — iş kuralları (default koruması, self-ref reddi, home taşıma)
- `src/tabs/tabs.controller.ts` — endpoint'ler
- `src/tabs/tabs.module.ts` — modül (imports: [Neo4jModule]; exports: [TabsService, TabsRepository])
- `src/neo4j/migrations/data/005-tabs.ts` — default tab + homeTabId backfill
- `src/neo4j/migrations/002_tab_constraint.cypher` — tab_id_unique
- Modify: `src/nodes/schemas/base.schema.ts` (BaseNodeSchema + homeTabId), `src/nodes/dto/create-node.dto.ts` (CreatableBaseFields + homeTabId), `src/nodes/nodes.repository.ts` (StoredNode + homeTabId), `src/nodes/nodes.service.ts` (default tab), `src/nodes/nodes.module.ts` (import TabsModule)
- Modify: `src/projects/projects.service.ts` + `projects.module.ts` (create → default tab), `src/projects/projects.repository.ts` (nodeFromRecord homeTabId)
- Modify: `src/graph/dto/apply-graph.dto.ts` + `graph.service.ts` + `graph.module.ts` (tabId)
- Modify: `src/ai/ai.service.ts` + `dto/chat.dto.ts` + `ai.module.ts` (tabId)
- Modify: `src/app.module.ts` (TabsModule), `package.json` (migrate:tabs script)
- Test: `test/tabs.e2e-spec.ts`

---

### Task 1: Tab Zod şeması + DTO'lar

**Files:**
- Create: `src/tabs/schemas/tab.schema.ts`, `src/tabs/dto/create-tab.dto.ts`, `update-tab.dto.ts`, `reference.dto.ts`, `layout.dto.ts`
- Test: `src/tabs/schemas/tab.schema.spec.ts`

- [ ] **Step 1: Şema**

`src/tabs/schemas/tab.schema.ts`:

```ts
import { z } from "zod";

export const CreateTabSchema = z.object({
  name: z.string().min(1),
  moduleNodeId: z.string().uuid().optional(),
}).strict();

export const UpdateTabSchema = z.object({
  name: z.string().min(1).optional(),
  order: z.number().int().nonnegative().optional(),
}).strict();

export const ReferenceSchema = z.object({
  x: z.number(),
  y: z.number(),
}).strict();

export const LayoutSchema = z.object({
  items: z.array(z.object({
    nodeId: z.string().uuid(),
    x: z.number(),
    y: z.number(),
  }).strict()).min(1),
}).strict();

export type CreateTabInput = z.infer<typeof CreateTabSchema>;
export type UpdateTabInput = z.infer<typeof UpdateTabSchema>;
export type ReferenceInput = z.infer<typeof ReferenceSchema>;
export type LayoutInput = z.infer<typeof LayoutSchema>;

export interface StoredTab {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  order: number;
  moduleNodeId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Bir sekmenin render içeriği: pozisyonlu node'lar + aralarındaki edge'ler. */
export interface TabGraphMember {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  position: { x: number; y: number };
  isReference: boolean;
  origin?: string; // referans ise node'un ev sekmesi (homeTabId)
}
export interface TabGraphEdge {
  id: string;
  kind: string;
  sourceNodeId: string;
  targetNodeId: string;
}
export interface TabGraph {
  tab: StoredTab;
  nodes: TabGraphMember[];
  edges: TabGraphEdge[];
}
```

- [ ] **Step 2: DTO'lar**

`create-tab.dto.ts`:
```ts
import { createZodDto } from "nestjs-zod";
import { CreateTabSchema } from "../schemas/tab.schema";
export class CreateTabDto extends createZodDto(CreateTabSchema) {}
```
`update-tab.dto.ts`:
```ts
import { createZodDto } from "nestjs-zod";
import { UpdateTabSchema } from "../schemas/tab.schema";
export class UpdateTabDto extends createZodDto(UpdateTabSchema) {}
```
`reference.dto.ts`:
```ts
import { createZodDto } from "nestjs-zod";
import { ReferenceSchema } from "../schemas/tab.schema";
export class ReferenceDto extends createZodDto(ReferenceSchema) {}
```
`layout.dto.ts`:
```ts
import { createZodDto } from "nestjs-zod";
import { LayoutSchema } from "../schemas/tab.schema";
export class LayoutDto extends createZodDto(LayoutSchema) {}
```

- [ ] **Step 3: Failing test**

`src/tabs/schemas/tab.schema.spec.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CreateTabSchema, LayoutSchema } from "./tab.schema";

describe("Tab schemas", () => {
  it("CreateTab geçerli", () => {
    expect(CreateTabSchema.parse({ name: "Sipariş Modülü" }).name).toBe("Sipariş Modülü");
  });
  it("CreateTab boş isim reddeder", () => {
    expect(() => CreateTabSchema.parse({ name: "" })).toThrow();
  });
  it("Layout boş items reddeder", () => {
    expect(() => LayoutSchema.parse({ items: [] })).toThrow();
  });
  it("Layout geçerli item kabul eder", () => {
    expect(LayoutSchema.parse({ items: [{ nodeId: "550e8400-e29b-41d4-a716-446655440000", x: 1, y: 2 }] }).items).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Test pass + commit**

Run: `pnpm vitest run src/tabs/schemas`
Expected: PASS (4 test).
```bash
git add src/tabs/schemas src/tabs/dto
git commit -m "feat(tabs): Zod şema + DTO (CreateTab/UpdateTab/Reference/Layout)"
```

---

### Task 2: TabsRepository (Cypher)

**Files:**
- Create: `src/tabs/tabs.repository.ts`
- Test: `src/tabs/tabs.repository.spec.ts`

- [ ] **Step 1: Repository**

`src/tabs/tabs.repository.ts`:

```ts
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

  async update(projectId: string, tabId: string, patch: { name?: string; order?: number; updatedAt: string }): Promise<StoredTab | null> {
    const sets: string[] = ["t.updatedAt = datetime($updatedAt)"];
    if (patch.name !== undefined) sets.push("t.name = $name");
    if (patch.order !== undefined) sets.push("t.order = $order");
    const r = await this.neo4j.run(
      `MATCH (t:Tab {id: $tabId, projectId: $projectId}) SET ${sets.join(", ")} RETURN t`,
      { projectId, tabId, name: patch.name ?? null, order: patch.order ?? null, updatedAt: patch.updatedAt },
    );
    return r.records.length ? toStoredTab(r.records[0].get("t").properties) : null;
  }

  /** Sekmeyi sil: owned node'ların evini default'a taşı, REFERENCES'larını kaldır, tab'ı sil. */
  async deleteAndReassign(projectId: string, tabId: string, defaultTabId: string): Promise<void> {
    await this.neo4j.run(
      `MATCH (n:Node {projectId: $projectId, homeTabId: $tabId}) SET n.homeTabId = $defaultTabId`,
      { projectId, tabId, defaultTabId },
    );
    await this.neo4j.run(
      `MATCH (t:Tab {id: $tabId, projectId: $projectId})-[r:REFERENCES]->() DELETE r`,
      { projectId, tabId },
    );
    await this.neo4j.run(
      `MATCH (t:Tab {id: $tabId, projectId: $projectId}) DELETE t`,
      { projectId, tabId },
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
    const visibleIds = new Set(members.map((m) => m.id));

    const edgesRes = await this.neo4j.run(
      `MATCH (s:Node)-[e]->(t:Node)
       WHERE e.projectId = $projectId AND s.id IN $ids AND t.id IN $ids
       RETURN e.id AS id, type(e) AS kind, s.id AS sourceNodeId, t.id AS targetNodeId`,
      { projectId, ids: [...visibleIds] },
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
    isReference,
    origin: isReference ? p.homeTabId : undefined,
  };
}
```

- [ ] **Step 2: Failing test (mock Neo4jService)**

`src/tabs/tabs.repository.spec.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { TabsRepository } from "./tabs.repository";

const neo4j = { run: vi.fn() };
const repo = new TabsRepository(neo4j as any);

describe("TabsRepository", () => {
  it("upsertReference MERGE kullanır", async () => {
    neo4j.run.mockResolvedValueOnce({ records: [] });
    await repo.upsertReference("p", "t", "n", 10, 20);
    expect(neo4j.run.mock.calls[0][0]).toContain("MERGE (t)-[r:REFERENCES]->(n)");
    expect(neo4j.run.mock.calls[0][1]).toMatchObject({ projectId: "p", tabId: "t", nodeId: "n", x: 10, y: 20 });
  });

  it("findDefault isDefault:true filtreler", async () => {
    neo4j.run.mockResolvedValueOnce({ records: [] });
    expect(await repo.findDefault("p")).toBeNull();
    expect(neo4j.run.mock.calls[0][0]).toContain("isDefault: true");
  });

  it("removeReference yoksa false", async () => {
    neo4j.run.mockResolvedValueOnce({ records: [] });
    expect(await repo.removeReference("p", "t", "n")).toBe(false);
  });
});
```

- [ ] **Step 3: Test pass + commit**

Run: `pnpm vitest run src/tabs/tabs.repository.spec.ts`
Expected: PASS (3 test).
```bash
git add src/tabs/tabs.repository.ts src/tabs/tabs.repository.spec.ts
git commit -m "feat(tabs): repository — tab CRUD + REFERENCES upsert + tabGraph + layout"
```

---

### Task 3: TabsService (iş kuralları)

**Files:**
- Create: `src/tabs/tabs.service.ts`
- Test: `src/tabs/tabs.service.spec.ts`

- [ ] **Step 1: Service**

`src/tabs/tabs.service.ts`:

```ts
import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { TabsRepository } from "./tabs.repository";
import type { StoredTab, TabGraph, CreateTabInput, UpdateTabInput } from "./schemas/tab.schema";

@Injectable()
export class TabsService {
  constructor(private readonly repo: TabsRepository) {}

  /** Projenin default ("Ana Mimari") sekmesi — yoksa oluşturur (idempotent). */
  async ensureDefault(projectId: string): Promise<StoredTab> {
    const existing = await this.repo.findDefault(projectId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const tab: StoredTab = {
      id: randomUUID(), projectId, name: "Ana Mimari",
      isDefault: true, order: 0, createdAt: now, updatedAt: now,
    };
    await this.repo.create(tab);
    return tab;
  }

  async create(projectId: string, input: CreateTabInput): Promise<StoredTab> {
    await this.assertProject(projectId);
    const order = (await this.repo.maxOrder(projectId)) + 1;
    const now = new Date().toISOString();
    const tab: StoredTab = {
      id: randomUUID(), projectId, name: input.name,
      isDefault: false, order, moduleNodeId: input.moduleNodeId,
      createdAt: now, updatedAt: now,
    };
    await this.repo.create(tab);
    return tab;
  }

  async list(projectId: string): Promise<StoredTab[]> {
    await this.assertProject(projectId);
    return this.repo.list(projectId);
  }

  async getById(projectId: string, tabId: string): Promise<StoredTab> {
    const tab = await this.repo.getById(projectId, tabId);
    if (!tab) throw this.tabNotFound(tabId);
    return tab;
  }

  async update(projectId: string, tabId: string, input: UpdateTabInput): Promise<StoredTab> {
    const updated = await this.repo.update(projectId, tabId, { ...input, updatedAt: new Date().toISOString() });
    if (!updated) throw this.tabNotFound(tabId);
    return updated;
  }

  async delete(projectId: string, tabId: string): Promise<void> {
    const tab = await this.getById(projectId, tabId);
    if (tab.isDefault) {
      throw new BadRequestException({
        code: "ERR_TAB_DEFAULT_DELETE",
        message: "Varsayılan 'Ana Mimari' sekmesi silinemez.",
      });
    }
    const def = await this.repo.findDefault(projectId);
    if (!def) throw this.tabNotFound("default");
    await this.repo.deleteAndReassign(projectId, tabId, def.id);
  }

  async tabGraph(projectId: string, tabId: string): Promise<TabGraph> {
    const tab = await this.getById(projectId, tabId);
    return this.repo.tabGraph(projectId, tab);
  }

  async addReference(projectId: string, tabId: string, nodeId: string, x: number, y: number): Promise<void> {
    const tab = await this.getById(projectId, tabId);
    if (!(await this.repo.nodeExists(projectId, nodeId))) {
      throw new NotFoundException({ code: "ERR_NODE_NOT_FOUND", message: `Node '${nodeId}' bulunamadı.` });
    }
    // Node'u kendi ev sekmesine referans olarak eklemek anlamsız.
    const homeTabId = await this.nodeHomeTab(projectId, nodeId);
    if (homeTabId === tab.id) {
      throw new BadRequestException({
        code: "ERR_TAB_SELF_REFERENCE",
        message: "Node zaten bu sekmenin sahibi; referans eklenemez.",
      });
    }
    await this.repo.upsertReference(projectId, tab.id, nodeId, x, y);
  }

  async removeReference(projectId: string, tabId: string, nodeId: string): Promise<void> {
    await this.getById(projectId, tabId);
    if (!(await this.repo.removeReference(projectId, tabId, nodeId))) {
      throw new NotFoundException({ code: "ERR_REFERENCE_NOT_FOUND", message: `Referans bulunamadı.` });
    }
  }

  async saveLayout(projectId: string, tabId: string, items: { nodeId: string; x: number; y: number }[]): Promise<void> {
    await this.getById(projectId, tabId);
    await this.repo.saveLayout(projectId, tabId, items);
  }

  private async nodeHomeTab(projectId: string, nodeId: string): Promise<string | null> {
    return this.repo.nodeHomeTab(projectId, nodeId);
  }

  private async assertProject(projectId: string): Promise<void> {
    if (!(await this.repo.projectExists(projectId))) {
      throw new NotFoundException({ code: "ERR_PROJECT_NOT_FOUND", message: `Project '${projectId}' bulunamadı.` });
    }
  }

  private tabNotFound(tabId: string): NotFoundException {
    return new NotFoundException({ code: "ERR_TAB_NOT_FOUND", message: `Sekme '${tabId}' bulunamadı.` });
  }
}
```

- [ ] **Step 2: `nodeHomeTab` repo metodunu ekle**

`src/tabs/tabs.repository.ts` içine ekle (sınıfa):
```ts
  async nodeHomeTab(projectId: string, nodeId: string): Promise<string | null> {
    const r = await this.neo4j.run(
      `MATCH (n:Node {id: $nodeId, projectId: $projectId}) RETURN n.homeTabId AS h`,
      { projectId, nodeId },
    );
    return r.records.length ? (r.records[0].get("h") ?? null) : null;
  }
```

- [ ] **Step 3: Failing test (mock repo)**

`src/tabs/tabs.service.spec.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { TabsService } from "./tabs.service";

function make() {
  const repo = {
    findDefault: vi.fn(), create: vi.fn(), list: vi.fn(), getById: vi.fn(),
    update: vi.fn(), deleteAndReassign: vi.fn(), maxOrder: vi.fn().mockResolvedValue(0),
    projectExists: vi.fn().mockResolvedValue(true), nodeExists: vi.fn().mockResolvedValue(true),
    upsertReference: vi.fn(), removeReference: vi.fn(), nodeHomeTab: vi.fn(), tabGraph: vi.fn(),
  };
  return { svc: new TabsService(repo as any), repo };
}

describe("TabsService", () => {
  it("ensureDefault varsa oluşturmaz", async () => {
    const { svc, repo } = make();
    repo.findDefault.mockResolvedValue({ id: "d", isDefault: true });
    await svc.ensureDefault("p");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("ensureDefault yoksa Ana Mimari oluşturur", async () => {
    const { svc, repo } = make();
    repo.findDefault.mockResolvedValue(null);
    const t = await svc.ensureDefault("p");
    expect(t.name).toBe("Ana Mimari");
    expect(t.isDefault).toBe(true);
    expect(repo.create).toHaveBeenCalled();
  });

  it("default sekme silinemez", async () => {
    const { svc, repo } = make();
    repo.getById.mockResolvedValue({ id: "d", isDefault: true });
    await expect(svc.delete("p", "d")).rejects.toThrow();
  });

  it("node kendi ev sekmesine referans edilemez", async () => {
    const { svc, repo } = make();
    repo.getById.mockResolvedValue({ id: "t1", isDefault: false });
    repo.nodeHomeTab.mockResolvedValue("t1");
    await expect(svc.addReference("p", "t1", "n", 0, 0)).rejects.toThrow();
  });

  it("addReference farklı ev sekmesinde upsert eder", async () => {
    const { svc, repo } = make();
    repo.getById.mockResolvedValue({ id: "t2", isDefault: false });
    repo.nodeHomeTab.mockResolvedValue("t1");
    await svc.addReference("p", "t2", "n", 5, 6);
    expect(repo.upsertReference).toHaveBeenCalledWith("p", "t2", "n", 5, 6);
  });
});
```

- [ ] **Step 4: Test pass + commit**

Run: `pnpm vitest run src/tabs/tabs.service.spec.ts`
Expected: PASS (5 test).
```bash
git add src/tabs/tabs.service.ts src/tabs/tabs.repository.ts src/tabs/tabs.service.spec.ts
git commit -m "feat(tabs): service — default koruması, self-ref reddi, home taşıma"
```

---

### Task 4: TabsController + modül + app.module

**Files:**
- Create: `src/tabs/tabs.controller.ts`, `src/tabs/tabs.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/tabs/tabs.controller.spec.ts`

- [ ] **Step 1: Controller**

`src/tabs/tabs.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { TabsService } from "./tabs.service";
import { CreateTabDto } from "./dto/create-tab.dto";
import { UpdateTabDto } from "./dto/update-tab.dto";
import { ReferenceDto } from "./dto/reference.dto";
import { LayoutDto } from "./dto/layout.dto";
import { ok } from "../common/envelope";

@ApiTags("Tabs (Contexts)")
@Controller("projects/:projectId/tabs")
export class TabsController {
  constructor(private readonly service: TabsService) {}

  @Post()
  @ApiOperation({ summary: "Sekme oluştur", description: "Yeni context/canvas sekmesi. moduleNodeId opsiyonel (drill-down kaynağı)." })
  @ApiParam({ name: "projectId", description: "Proje UUID" })
  async create(@Param("projectId") projectId: string, @Body() body: CreateTabDto) {
    return ok(await this.service.create(projectId, body as any));
  }

  @Get()
  @ApiOperation({ summary: "Sekme listesi", description: "order'a göre sıralı." })
  async list(@Param("projectId") projectId: string) {
    return ok(await this.service.list(projectId));
  }

  @Get(":tabId")
  @ApiOperation({ summary: "Sekme detayı" })
  @ApiResponse({ status: 404, description: "ERR_TAB_NOT_FOUND" })
  async getById(@Param("projectId") projectId: string, @Param("tabId") tabId: string) {
    return ok(await this.service.getById(projectId, tabId));
  }

  @Get(":tabId/graph")
  @ApiOperation({ summary: "Sekme render içeriği", description: "owned + referenced node'lar (pozisyon + origin) + aralarındaki edge'ler." })
  async graph(@Param("projectId") projectId: string, @Param("tabId") tabId: string) {
    return ok(await this.service.tabGraph(projectId, tabId));
  }

  @Patch(":tabId")
  @ApiOperation({ summary: "Sekme güncelle (isim/sıra)" })
  async update(@Param("projectId") projectId: string, @Param("tabId") tabId: string, @Body() body: UpdateTabDto) {
    return ok(await this.service.update(projectId, tabId, body as any));
  }

  @Delete(":tabId")
  @HttpCode(204)
  @ApiOperation({ summary: "Sekme sil", description: "Default silinemez. Owned node'lar Ana Mimari'ye taşınır, referanslar kalkar." })
  @ApiResponse({ status: 400, description: "ERR_TAB_DEFAULT_DELETE" })
  async delete(@Param("projectId") projectId: string, @Param("tabId") tabId: string) {
    await this.service.delete(projectId, tabId);
  }

  @Put(":tabId/references/:nodeId")
  @ApiOperation({ summary: "Node'u sekmeye import et / referans konumu güncelle" })
  @ApiResponse({ status: 400, description: "ERR_TAB_SELF_REFERENCE" })
  async addReference(
    @Param("projectId") projectId: string,
    @Param("tabId") tabId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: ReferenceDto,
  ) {
    const { x, y } = body as any;
    await this.service.addReference(projectId, tabId, nodeId, x, y);
    return ok({ tabId, nodeId, x, y });
  }

  @Delete(":tabId/references/:nodeId")
  @HttpCode(204)
  @ApiOperation({ summary: "Referansı kaldır (node silinmez)" })
  async removeReference(@Param("projectId") projectId: string, @Param("tabId") tabId: string, @Param("nodeId") nodeId: string) {
    await this.service.removeReference(projectId, tabId, nodeId);
  }

  @Patch(":tabId/layout")
  @ApiOperation({ summary: "Toplu konum kaydet", description: "Sürükleme sonrası: owned → node konumu, referenced → referans konumu." })
  async layout(@Param("projectId") projectId: string, @Param("tabId") tabId: string, @Body() body: LayoutDto) {
    const { items } = body as any;
    await this.service.saveLayout(projectId, tabId, items);
    return ok({ tabId, updated: items.length });
  }
}
```

- [ ] **Step 2: Module**

`src/tabs/tabs.module.ts`:
```ts
import { Module } from "@nestjs/common";
import { Neo4jModule } from "../neo4j/neo4j.module";
import { TabsController } from "./tabs.controller";
import { TabsService } from "./tabs.service";
import { TabsRepository } from "./tabs.repository";

@Module({
  imports: [Neo4jModule],
  controllers: [TabsController],
  providers: [TabsService, TabsRepository],
  exports: [TabsService, TabsRepository],
})
export class TabsModule {}
```

- [ ] **Step 3: app.module.ts'e ekle**

`src/app.module.ts` import + imports dizisine `TabsModule` ekle.

- [ ] **Step 4: Controller smoke test**

`src/tabs/tabs.controller.spec.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { TabsController } from "./tabs.controller";

describe("TabsController", () => {
  const service = { create: vi.fn().mockResolvedValue({ id: "t" }), addReference: vi.fn(), saveLayout: vi.fn() };
  const c = new TabsController(service as any);

  it("create envelope döner", async () => {
    expect(await c.create("p", { name: "X" } as any)).toEqual({ success: true, data: { id: "t" } });
  });
  it("addReference x/y geçirir + envelope", async () => {
    const r = await c.addReference("p", "t", "n", { x: 3, y: 4 } as any);
    expect(service.addReference).toHaveBeenCalledWith("p", "t", "n", 3, 4);
    expect(r).toEqual({ success: true, data: { tabId: "t", nodeId: "n", x: 3, y: 4 } });
  });
});
```

- [ ] **Step 5: Test + build + commit**

Run: `pnpm vitest run src/tabs && pnpm build`
Expected: PASS + build temiz.
```bash
git add src/tabs/ src/app.module.ts
git commit -m "feat(tabs): controller + modül (CRUD + references + tab graph + layout)"
```

---

### Task 5: Node'a homeTabId ekle

**Files:**
- Modify: `src/nodes/schemas/base.schema.ts`, `src/nodes/dto/create-node.dto.ts`, `src/nodes/nodes.repository.ts`, `src/nodes/nodes.service.ts`, `src/nodes/nodes.module.ts`, `src/projects/projects.repository.ts`
- Test: mevcut `src/nodes/nodes.service.spec.ts` güncelle

- [ ] **Step 1: BaseNodeSchema + create DTO**

`src/nodes/schemas/base.schema.ts` — `BaseNodeSchema`'ya ekle:
```ts
  homeTabId: z.string().uuid().optional(),
```
`src/nodes/dto/create-node.dto.ts` — `CreatableBaseFields`'a ekle:
```ts
const CreatableBaseFields = {
  projectId: z.string().uuid(),
  position: PositionSchema,
  homeTabId: z.string().uuid().optional(), // verilmezse default sekme
};
```

- [ ] **Step 2: StoredNode + repository SET/READ**

`src/nodes/nodes.repository.ts`:
- `StoredNode` interface'ine `homeTabId: string;` ekle.
- `create` Cypher'ına `homeTabId: $homeTabId` ekle + params'a `homeTabId: node.homeTabId`.
- `toStoredNode` (dosya sonundaki): `homeTabId: props.homeTabId,` ekle.

- [ ] **Step 3: NodesService default tab + NodesModule**

`src/nodes/nodes.service.ts`:
- Constructor'a `private readonly tabs: TabsService` ekle (import `TabsService`).
- `create` içinde, stored oluşturmadan önce:
```ts
const homeTabId = input.homeTabId ?? (await this.tabs.ensureDefault(urlProjectId)).id;
```
- `stored`'a `homeTabId` ekle. `CreateInput` tipine `homeTabId?: string` ekle.
- `toNode` ve `Node` dönüşüne homeTabId ekle (BaseNode'da var).

`src/nodes/nodes.module.ts` — imports'a `TabsModule` ekle (+ import).

`src/projects/projects.repository.ts` — `nodeFromRecord`'a `homeTabId: props.homeTabId,` ekle (Node tipinde alan opsiyonel).

> **Not:** `Node`/`BaseNode` tipinde `homeTabId?: string` görünür. `src/nodes/schemas/base.schema.ts` BaseNodeSchema güncellenince tip otomatik gelir.

- [ ] **Step 4: nodes.service.spec fixture güncelle**

`src/nodes/nodes.service.spec.ts` — NodesService artık 3. bağımlılık (TabsService) alıyor. Mock ekle:
```ts
const tabs = { ensureDefault: vi.fn().mockResolvedValue({ id: "tab-default" }) };
// service kurulumunda: new NodesService(repo, projectsRepo, tabs as any)
```
(Mevcut testlerde NodesService instantiation satırlarına 3. argümanı ekle.)

- [ ] **Step 5: Test + build + commit**

Run: `pnpm vitest run src/nodes && pnpm build`
Expected: PASS + build temiz.
```bash
git add src/nodes/ src/projects/projects.repository.ts
git commit -m "feat(nodes): homeTabId — node create default sekmeye yerleşir"
```

---

### Task 6: Proje oluşturunca default sekme

**Files:**
- Modify: `src/projects/projects.service.ts`, `src/projects/projects.module.ts`
- Test: `src/projects/projects.service.spec.ts`

- [ ] **Step 1: ProjectsService.create → ensureDefault**

`src/projects/projects.service.ts`:
- Constructor'a `private readonly tabs: TabsService` ekle (import).
- `create` içinde `await this.repo.create(stored);` sonrasına:
```ts
await this.tabs.ensureDefault(stored.id);
```

`src/projects/projects.module.ts` — imports'a `TabsModule` ekle.

> **Döngü kontrolü:** TabsModule yalnızca Neo4jModule import eder → Projects→Tabs tek yönlü, döngü yok.

- [ ] **Step 2: Test güncelle**

`src/projects/projects.service.spec.ts` — ProjectsService artık TabsService alıyor:
```ts
const tabs = { ensureDefault: vi.fn().mockResolvedValue({ id: "t" }) };
// new ProjectsService(repo, tabs as any)
```
Yeni test:
```ts
it("create default sekme oluşturur", async () => {
  await service.create({ name: "P", description: "", status: "draft" } as any);
  expect(tabs.ensureDefault).toHaveBeenCalled();
});
```

- [ ] **Step 3: Test + build + commit**

Run: `pnpm vitest run src/projects && pnpm build`
Expected: PASS.
```bash
git add src/projects/
git commit -m "feat(projects): proje oluşturunca Ana Mimari sekmesi otomatik kurulur"
```

---

### Task 7: graph/apply + ai/chat → tabId

**Files:**
- Modify: `src/graph/dto/apply-graph.dto.ts`, `src/graph/graph.service.ts`, `src/graph/graph.module.ts`, `src/ai/dto/chat.dto.ts`, `src/ai/ai.service.ts`
- Test: mevcut `src/graph/graph.service.spec.ts` güncelle

- [ ] **Step 1: apply DTO + service tabId**

`src/graph/dto/apply-graph.dto.ts` — `ApplyGraphSchema`'ya ekle (mutations'ın yanına):
```ts
export const ApplyGraphSchema = z.object({
  tabId: z.string().uuid().optional(), // üretilen node'ların ev sekmesi
  mutations: z.object({ /* mevcut */ }).strict(),
}).strict();
```

`src/graph/graph.service.ts`:
- Constructor'a `private readonly tabs: TabsService` ekle (import `TabsService`).
- `apply` başında: `const homeTabId = input.tabId ?? (await this.tabs.ensureDefault(projectId)).id;`
- Node yaratılırken (StoredNode candidate) `homeTabId` ekle: `homeTabId,`.

`src/graph/graph.module.ts` — imports'a `TabsModule` ekle.

- [ ] **Step 2: chat DTO + ai.service tabId**

`src/ai/dto/chat.dto.ts` — `ChatSchema`'ya ekle:
```ts
  tabId: z.string().uuid().optional(),
```
`src/ai/ai.service.ts` — `graphService.apply(projectId, ...)` çağrısına `tabId`'yi geçir (apply input'una `tabId: input.tabId` ekle). AI tool çıktısını apply input'a dönüştüren yerde `tabId` ekle.

- [ ] **Step 3: graph.service.spec güncelle**

`src/graph/graph.service.spec.ts` — GraphService artık TabsService alıyor:
```ts
const tabs = { ensureDefault: vi.fn().mockResolvedValue({ id: "tab-default" }) };
// new GraphService(neo4j, projectsRepo, nodesRepo, rulesEngine, tabs as any)
```
Apply edilen node'ların `homeTabId` aldığını doğrulayan assertion ekle (stored node'da homeTabId = "tab-default").

- [ ] **Step 4: Test + build + commit**

Run: `pnpm vitest run src/graph src/ai && pnpm build`
Expected: PASS.
```bash
git add src/graph/ src/ai/
git commit -m "feat(graph,ai): apply + chat opsiyonel tabId — node'lar hedef sekmeye ev sahibi"
```

---

### Task 8: Migration + constraint

**Files:**
- Create: `src/neo4j/migrations/data/005-tabs.ts`, `src/neo4j/migrations/002_tab_constraint.cypher`
- Modify: `package.json`

- [ ] **Step 1: Constraint**

`src/neo4j/migrations/002_tab_constraint.cypher`:
```cypher
CREATE CONSTRAINT tab_id_unique IF NOT EXISTS FOR (t:Tab) REQUIRE t.id IS UNIQUE;
```

- [ ] **Step 2: Migration scripti**

`src/neo4j/migrations/data/005-tabs.ts`:
```ts
import { randomUUID } from "node:crypto";
import { Neo4jService } from "../../neo4j.service";
import { env } from "../../../config/env";

/** Her projeye default "Ana Mimari" sekmesi + her node'a homeTabId backfill.
 *  Idempotent — node.position KORUNUR. */
async function main(): Promise<void> {
  const svc = new Neo4jService({ uri: env.NEO4J_URI, user: env.NEO4J_USER, password: env.NEO4J_PASSWORD });
  await svc.onModuleInit();

  const projects = await svc.run(`MATCH (p:Project) RETURN p.id AS id`);
  let tabs = 0, backfilled = 0;
  for (const rec of projects.records) {
    const projectId = rec.get("id");
    let def = await svc.run(`MATCH (t:Tab {projectId: $projectId, isDefault: true}) RETURN t.id AS id LIMIT 1`, { projectId });
    let tabId: string;
    if (def.records.length === 0) {
      tabId = randomUUID();
      const now = new Date().toISOString();
      await svc.run(
        `CREATE (t:Tab { id: $id, projectId: $projectId, name: 'Ana Mimari', isDefault: true, order: 0, moduleNodeId: null, createdAt: datetime($now), updatedAt: datetime($now) })`,
        { id: tabId, projectId, now },
      );
      tabs++;
    } else {
      tabId = def.records[0].get("id");
    }
    const res = await svc.run(
      `MATCH (n:Node {projectId: $projectId}) WHERE n.homeTabId IS NULL SET n.homeTabId = $tabId RETURN count(n) AS c`,
      { projectId, tabId },
    );
    backfilled += Number(res.records[0].get("c"));
  }

  await svc.onModuleDestroy();
  console.log(`✓ Tabs migration: ${tabs} default sekme, ${backfilled} node homeTabId backfill.`);
}

main().catch((e) => { console.error("✗ Tabs migration failed:", e); process.exit(1); });
```

- [ ] **Step 3: package.json script + çalıştır**

`scripts`'e ekle:
```json
"migrate:tabs": "tsx --env-file=.env src/neo4j/migrations/data/005-tabs.ts"
```
Run: `pnpm neo4j:migrate && pnpm migrate:tabs`
Expected: constraint kurulur + `✓ Tabs migration: N default sekme, M node homeTabId backfill.` (ikinci çalıştırmada 0/0 — idempotent)

- [ ] **Step 4: Commit**

```bash
git add src/neo4j/migrations/ package.json
git commit -m "feat(neo4j): tabs migration — default sekme + homeTabId backfill + tab_id_unique"
```

---

### Task 9: E2E + tam test + push

**Files:**
- Create: `test/tabs.e2e-spec.ts`
- Referans: `test/patterns.e2e-spec.ts` (bootstrap)

- [ ] **Step 1: E2E**

`test/tabs.e2e-spec.ts` — `test/patterns.e2e-spec.ts`'in bootstrap'ını birebir izle (Testcontainers Neo4j 5-community + overrideProvider(Neo4jService) + global ZodPipe + prefix + 4 filter). EMBEDDINGS override GEREKMEZ (tabs embedding kullanmaz). Constraint'leri beforeAll'da kur:
```ts
await neo4j.run("CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE");
await neo4j.run("CREATE CONSTRAINT tab_id_unique IF NOT EXISTS FOR (t:Tab) REQUIRE t.id IS UNIQUE");
```
Bir proje + bir node oluştur (API üzerinden), sonra:

```ts
const base = "/api/v1";
let projectId: string;
let nodeId: string;

it("proje açılınca Ana Mimari sekmesi oluşur", async () => {
  const p = await request(app.getHttpServer()).post(`${base}/projects`).send({ name: "Tab E2E" }).expect(201);
  projectId = p.body.data.id;
  const tabs = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs`).expect(200);
  expect(tabs.body.data.length).toBe(1);
  expect(tabs.body.data[0].isDefault).toBe(true);
  expect(tabs.body.data[0].name).toBe("Ana Mimari");
});

it("node default sekmeye ev sahibi olur, tab graph'ta görünür", async () => {
  const n = await request(app.getHttpServer()).post(`${base}/projects/${projectId}/nodes`).send({
    projectId, position: { x: 10, y: 20 }, type: "Service",
    properties: { ServiceName: "OrderSvc", Description: "d", IsTransactionScoped: false, Methods: [{ MethodName: "x", ReturnType: "void" }] },
  }).expect(201);
  nodeId = n.body.data.id;
  const tabs = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs`).expect(200);
  const defId = tabs.body.data[0].id;
  const g = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs/${defId}/graph`).expect(200);
  expect(g.body.data.nodes).toHaveLength(1);
  expect(g.body.data.nodes[0].isReference).toBe(false);
  expect(g.body.data.nodes[0].position).toEqual({ x: 10, y: 20 });
});

it("yeni sekme + node import (referans) round-trip", async () => {
  const t = await request(app.getHttpServer()).post(`${base}/projects/${projectId}/tabs`).send({ name: "Sipariş" }).expect(201);
  const tabId = t.body.data.id;
  // import et
  await request(app.getHttpServer()).put(`${base}/projects/${projectId}/tabs/${tabId}/references/${nodeId}`).send({ x: 99, y: 88 }).expect(200);
  const g = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs/${tabId}/graph`).expect(200);
  expect(g.body.data.nodes).toHaveLength(1);
  expect(g.body.data.nodes[0].isReference).toBe(true);
  expect(g.body.data.nodes[0].position).toEqual({ x: 99, y: 88 });
  // referansı kaldır
  await request(app.getHttpServer()).delete(`${base}/projects/${projectId}/tabs/${tabId}/references/${nodeId}`).expect(204);
  const g2 = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs/${tabId}/graph`).expect(200);
  expect(g2.body.data.nodes).toHaveLength(0);
});

it("default sekme silinemez (400)", async () => {
  const tabs = await request(app.getHttpServer()).get(`${base}/projects/${projectId}/tabs`).expect(200);
  const defId = tabs.body.data.find((t: any) => t.isDefault).id;
  await request(app.getHttpServer()).delete(`${base}/projects/${projectId}/tabs/${defId}`).expect(400);
});

it("sekme silinince owned node Ana Mimari'ye taşınır", async () => {
  const t = await request(app.getHttpServer()).post(`${base}/projects/${projectId}/tabs`).send({ name: "Geçici" }).expect(201);
  const tabId = t.body.data.id;
  const n = await request(app.getHttpServer()).post(`${base}/projects/${projectId}/nodes`).send({
    projectId, position: { x: 1, y: 1 }, homeTabId: tabId, type: "Cache",
    properties: { CacheName: "C", Description: "d", KeyPattern: "k", TTL_Seconds: 60, Engine: "Redis" },
  }).expect(201);
  await request(app.getHttpServer()).delete(`${base}/projects/${projectId}/tabs/${tabId}`).expect(204);
  // node hâlâ var (mantıksal grafta)
  await request(app.getHttpServer()).get(`${base}/projects/${projectId}/nodes/${n.body.data.id}`).expect(200);
});
```

- [ ] **Step 2: Tüm test paketi**

Run: `pnpm test`
Expected: tüm unit PASS.

Run: `pnpm test:e2e`
Expected: tabs + nodes + patterns e2e hepsi PASS.

- [ ] **Step 3: Canlı duman testi (opsiyonel ama önerilir)**

```bash
pnpm build && pnpm neo4j:migrate && pnpm migrate:tabs
fuser -k 4000/tcp 2>/dev/null; set -a; source .env; set +a; PORT=4000 node dist/main.js &
# proje oluştur → GET tabs (Ana Mimari görünmeli) → node ekle → tab graph
```
Expected: yeni proje Ana Mimari sekmesiyle gelir, node tab graph'ta owned olarak görünür.

- [ ] **Step 4: Memory + push**

`project_solarch_backend_phase1.md`'ye Tabs özeti ekle (model + endpoint'ler + migration + gotchas).
```bash
git add test/tabs.e2e-spec.ts
git commit -m "test(tabs): e2e — default sekme + node import (referans) + home taşıma"
git push origin main
```

---

## Faz Çıkış Kriterleri (Spec ile)

- [ ] Tek ev + referans modeli: node.homeTabId + (:Tab)-[:REFERENCES]->(:Node) (Task 1,2,5)
- [ ] Tabs CRUD + references + tab graph + layout (Task 2,3,4)
- [ ] Default sekme koruması + home taşıma + self-ref reddi (Task 3)
- [ ] Proje oluşturunca + node create default sekme (Task 5,6)
- [ ] apply/ai opsiyonel tabId (Task 7)
- [ ] Migration default sekme + homeTabId backfill, idempotent, node.position korunur (Task 8)
- [ ] E2E round-trip (Task 9)

## Notlar

- **node.position KORUNUR** — bu faz büyük ölçüde additive; apply/AI/CRUD/graph mevcut akışları çalışmaya devam eder.
- **Döngü önleme:** TabsModule yalnızca Neo4jModule import eder; existence check'leri kendi Cypher'ıyla. Projects/Nodes/Graph → Tabs tek yönlü.
- View sekmeleri (Infra/DBSchema/Flow) ve semantik-zoom out of scope (sonraki faz).
- Migration sırası: önce `neo4j:migrate` (constraint .cypher), sonra `migrate:tabs` (data).
