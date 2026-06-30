import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictException, NotFoundException, BadRequestException } from "@nestjs/common";
import { NodesService } from "./nodes.service";
import type { StoredNode } from "./nodes.repository";

function makeRepo(initial: StoredNode[] = []) {
  const store = new Map<string, StoredNode>(initial.map((n) => [n.id, n]));
  return {
    create: vi.fn(async (n: StoredNode) => { store.set(n.id, n); }),
    getById: vi.fn(async (_p: string, id: string) => store.get(id) ?? null),
    list: vi.fn(async (p: string, k?: string) => Array.from(store.values()).filter((n) => n.projectId === p && (!k || n.type === k))),
    update: vi.fn(async (p: string, id: string, upd: any) => {
      const existing = store.get(id);
      if (!existing) return null;
      // atomik version guard simülasyonu (repo ile aynı semantik)
      if (upd.expectedVersion !== undefined && (existing.version ?? 1) !== upd.expectedVersion) return null;
      const next = { ...existing };
      if (upd.positionX !== undefined) next.positionX = upd.positionX;
      if (upd.positionY !== undefined) next.positionY = upd.positionY;
      if (upd.properties !== undefined) next.properties = upd.properties;
      next.updatedAt = upd.updatedAt;
      next.version = (existing.version ?? 1) + 1;
      store.set(id, next);
      return next;
    }),
    delete: vi.fn(async (_p: string, id: string) => store.delete(id)),
    findByName: vi.fn(async (p: string, name: string) => {
      for (const n of store.values()) {
        if (n.projectId !== p) continue;
        const props = n.properties as Record<string, unknown>;
        if (props.TableName === name || props.Name === name || props.ClassName === name || props.ViewName === name) return n;
      }
      return null;
    }),
    findNameKey: vi.fn((kind: string) => kind === "Table" ? "TableName" : kind === "Model" ? "ClassName" : kind === "View" ? "ViewName" : "Name"),
  };
}

const projectsRepoMock = { exists: vi.fn(async () => true), bumpRevision: vi.fn(async () => 1) };
const tabsMock = { ensureDefault: vi.fn(async () => ({ id: "550e8400-e29b-41d4-a716-4466554400aa" })) };

const projectId = "550e8400-e29b-41d4-a716-446655440001";
const validTable = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  type: "Table" as const,
  projectId,
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
  properties: { TableName: "users", Description: "u", Columns: [{ Name: "id", DataType: "UUID" as const, IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }] },
};

describe("NodesService.create", () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: NodesService;

  beforeEach(() => {
    repo = makeRepo();
    service = new NodesService(repo as any, projectsRepoMock as any, tabsMock as any);
  });

  it("URL projectId ile body projectId uyuşmuyorsa BadRequestException fırlatır", async () => {
    await expect(service.create("other-project", validTable as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("id verilmediyse server üretir", async () => {
    const { id, ...noId } = validTable;
    const result = await service.create(projectId, noId as any);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("createdAt/updatedAt verilmediyse server üretir", async () => {
    const { createdAt, updatedAt, ...rest } = validTable;
    const result = await service.create(projectId, rest as any);
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();
  });

  it("aynı id zaten varsa ERR_ID_CONFLICT", async () => {
    repo = makeRepo([{ id: validTable.id, type: "Table", projectId, positionX: 0, positionY: 0, createdAt: "x", updatedAt: "x", properties: {} }]);
    service = new NodesService(repo as any, projectsRepoMock as any, tabsMock as any);
    await expect(service.create(projectId, validTable as any))
      .rejects.toMatchObject({ response: { code: "ERR_ID_CONFLICT" } });
  });

  it("aynı isim varsa ERR_NAME_DUPLICATE", async () => {
    repo = makeRepo([{ id: "550e8400-e29b-41d4-a716-446655440099", type: "Table", projectId, positionX: 0, positionY: 0, createdAt: "x", updatedAt: "x", properties: { TableName: "users" } }]);
    service = new NodesService(repo as any, projectsRepoMock as any, tabsMock as any);
    const { id, ...noId } = validTable;
    await expect(service.create(projectId, noId as any))
      .rejects.toMatchObject({ response: { code: "ERR_NAME_DUPLICATE" } });
  });
});

describe("NodesService.update", () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: NodesService;

  beforeEach(() => {
    repo = makeRepo([{
      id: validTable.id, type: "Table", projectId,
      positionX: 0, positionY: 0,
      createdAt: validTable.createdAt, updatedAt: validTable.updatedAt,
      version: 1,
      properties: validTable.properties,
    }]);
    service = new NodesService(repo as any, projectsRepoMock as any, tabsMock as any);
  });

  it("yok ise NotFoundException", async () => {
    await expect(service.update(projectId, "00000000-0000-0000-0000-000000000000", { position: { x: 1, y: 1 } }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("type değiştirmeye çalışırsa ERR_KIND_IMMUTABLE", async () => {
    await expect(service.update(projectId, validTable.id, { type: "DTO" } as any))
      .rejects.toMatchObject({ response: { code: "ERR_KIND_IMMUTABLE" } });
  });

  it("position update updatedAt'i de set eder", async () => {
    const result = await service.update(projectId, validTable.id, { position: { x: 99, y: 88 } });
    expect(result.position.x).toBe(99);
    expect(result.updatedAt).not.toBe(validTable.updatedAt);
  });

  it("expectedVersion uyuşmazsa ERR_VERSION_CONFLICT (lost-update engellenir)", async () => {
    await expect(service.update(projectId, validTable.id, { position: { x: 1, y: 1 }, expectedVersion: 99 }))
      .rejects.toMatchObject({ response: { code: "ERR_VERSION_CONFLICT" } });
  });

  it("doğru expectedVersion ile update geçer + version artar", async () => {
    const result = await service.update(projectId, validTable.id, { position: { x: 7, y: 7 }, expectedVersion: 1 });
    expect(result.position.x).toBe(7);
    expect(result.version).toBe(2);
  });

  it("expectedVersion verilmezse update geçer (geriye uyum) + version artar", async () => {
    const result = await service.update(projectId, validTable.id, { position: { x: 3, y: 3 } });
    expect(result.version).toBe(2);
  });
});

describe("NodesService.delete", () => {
  it("yok ise NotFoundException", async () => {
    const repo = makeRepo();
    const service = new NodesService(repo as any, projectsRepoMock as any, tabsMock as any);
    await expect(service.delete(projectId, "00000000-0000-0000-0000-000000000000"))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("var ise siler", async () => {
    const repo = makeRepo([{
      id: validTable.id, type: "Table", projectId,
      positionX: 0, positionY: 0,
      createdAt: validTable.createdAt, updatedAt: validTable.updatedAt,
      properties: validTable.properties,
    }]);
    const service = new NodesService(repo as any, projectsRepoMock as any, tabsMock as any);
    await expect(service.delete(projectId, validTable.id)).resolves.toBeUndefined();
  });
});
