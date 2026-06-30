import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { GraphService } from "./graph.service";

function makeDeps(opts: {
  projectExists?: boolean;
  evaluateResult?: any;
  graphRevision?: number;
  /** id → stored node; nodesRepo.getById bu haritadan döner. */
  existingNodes?: Record<string, any>;
  /** commit tx'indeki revizyon sorgusunun döneceği rev (undefined = kayıt yok). */
  txRevision?: number;
} = {}) {
  const txRun = vi.fn(async (cypher: string) => {
    if (cypher.includes("graphRevision")) {
      return opts.txRevision === undefined
        ? { records: [] }
        : { records: [{ get: () => opts.txRevision }] };
    }
    return { records: [] };
  });
  const neo4j = { write: vi.fn(async (work: any) => work({ run: txRun })) };
  const projectsRepo = {
    exists: vi.fn(async () => opts.projectExists ?? true),
    getGraphRevision: vi.fn(async () => opts.graphRevision ?? 0),
  };
  const nodesRepo = {
    findByName: vi.fn(async () => null),
    getById: vi.fn(async (_projectId: string, id: string) => opts.existingNodes?.[id] ?? null),
    findNameKey: vi.fn((kind: string) =>
      kind === "Table" ? "TableName" : kind === "Service" ? "ServiceName" : kind === "Controller" ? "ControllerName" : kind === "Repository" ? "RepositoryName" : "Name",
    ),
  };
  const rulesEngine = { evaluate: vi.fn(async () => opts.evaluateResult ?? { allowed: true }) };
  const tabs = { ensureDefault: vi.fn(async () => ({ id: "550e8400-e29b-41d4-a716-4466554400aa" })) };
  return { neo4j, projectsRepo, nodesRepo, rulesEngine, tabs, txRun };
}

const projectId = "550e8400-e29b-41d4-a716-446655440001";

const tableProps = (name: string) => ({
  TableName: name, Description: "d",
  Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }],
});
const svcProps = (name: string) => ({
  ServiceName: name, Description: "d",
  Methods: [{ MethodName: "x", Parameters: [], ReturnType: "void" }], IsTransactionScoped: false,
});

describe("GraphService.apply", () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: GraphService;

  beforeEach(() => {
    deps = makeDeps();
    service = new GraphService(deps.neo4j as any, deps.projectsRepo as any, deps.nodesRepo as any, deps.rulesEngine as any, deps.tabs as any);
  });

  it("proje yoksa NotFoundException", async () => {
    deps = makeDeps({ projectExists: false });
    service = new GraphService(deps.neo4j as any, deps.projectsRepo as any, deps.nodesRepo as any, deps.rulesEngine as any, deps.tabs as any);
    await expect(service.apply(projectId, { mutations: { nodes: [], edges: [] } } as any))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("geçerli batch → success + idMap + commit", async () => {
    const result = await service.apply(projectId, {
      mutations: {
        nodes: [
          { tempId: "t_svc", type: "Service", properties: svcProps("OrderSvc") },
          { tempId: "t_repo", type: "Repository", properties: { RepositoryName: "OrderRepo", Description: "d", EntityReference: "Order", CustomQueries: [] } },
        ],
        edges: [{ sourceTempId: "t_svc", targetTempId: "t_repo", edgeType: "CALLS" }],
      },
    } as any);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.idMap)).toEqual(["t_svc", "t_repo"]);
      expect(result.nodeCount).toBe(2);
      expect(result.edgeCount).toBe(1);
    }
    expect(deps.neo4j.write).toHaveBeenCalledOnce();
  });

  it("şema ihlali → ROLLED_BACK + commit yok", async () => {
    const result = await service.apply(projectId, {
      mutations: { nodes: [{ tempId: "t1", type: "Table", properties: { TableName: "x" } }], edges: [] },
    } as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.transactionStatus).toBe("ROLLED_BACK");
      expect(result.violations[0].code).toBe("ERR_SCHEMA_INVALID");
    }
    expect(deps.neo4j.write).not.toHaveBeenCalled();
  });

  it("Rules ihlali (ERR_002) → ROLLED_BACK", async () => {
    deps = makeDeps({ evaluateResult: { allowed: false, code: "ERR_002", message: "Controller DB'ye yazamaz", suggestion: "Repository ekle" } });
    service = new GraphService(deps.neo4j as any, deps.projectsRepo as any, deps.nodesRepo as any, deps.rulesEngine as any, deps.tabs as any);
    const result = await service.apply(projectId, {
      mutations: {
        nodes: [
          { tempId: "t_ctrl", type: "Controller", properties: { ControllerName: "C", Description: "d", BaseRoute: "/x", Endpoints: [{ HttpMethod: "POST", Route: "/", RequiresAuth: false }] } },
          { tempId: "t_tbl", type: "Table", properties: tableProps("orders") },
        ],
        edges: [{ sourceTempId: "t_ctrl", targetTempId: "t_tbl", edgeType: "WRITES" }],
      },
    } as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations[0].code).toBe("ERR_002");
      expect(result.violations[0].suggestion).toContain("Repository");
    }
    expect(deps.neo4j.write).not.toHaveBeenCalled();
  });

  it("batch-içi döngüsel CALLS → ERR_COND_001", async () => {
    const result = await service.apply(projectId, {
      mutations: {
        nodes: [
          { tempId: "a", type: "Service", properties: svcProps("A") },
          { tempId: "b", type: "Service", properties: svcProps("B") },
        ],
        edges: [
          { sourceTempId: "a", targetTempId: "b", edgeType: "CALLS" },
          { sourceTempId: "b", targetTempId: "a", edgeType: "CALLS" },
        ],
      },
    } as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations.some((v) => v.code === "ERR_COND_001")).toBe(true);
    }
  });

  it("duplicate tempId → ERR_DUPLICATE_TEMP_ID", async () => {
    const result = await service.apply(projectId, {
      mutations: {
        nodes: [
          { tempId: "dup", type: "Service", properties: svcProps("A") },
          { tempId: "dup", type: "Service", properties: svcProps("B") },
        ],
        edges: [],
      },
    } as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations.some((v) => v.code === "ERR_DUPLICATE_TEMP_ID")).toBe(true);
    }
  });

  it("geçersiz tempId referansı → ERR_EDGE_TEMP_NOT_FOUND", async () => {
    const result = await service.apply(projectId, {
      mutations: {
        nodes: [{ tempId: "a", type: "Service", properties: svcProps("A") }],
        edges: [{ sourceTempId: "a", targetTempId: "ghost", edgeType: "CALLS" }],
      },
    } as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations.some((v) => v.code === "ERR_EDGE_TEMP_NOT_FOUND")).toBe(true);
    }
  });
});

const cloudNodeId = "550e8400-e29b-41d4-a716-446655440099";
const cloudRepo = {
  id: cloudNodeId,
  type: "Repository",
  projectId,
  positionX: 0,
  positionY: 0,
  homeTabId: "tab",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
  properties: { RepositoryName: "OrderRepo", Description: "d", EntityReference: "Order", CustomQueries: [] },
};

describe("GraphService.apply — mevcut node'a edge (upsert köprüsü)", () => {
  it("yeni node → mevcut cloud node edge'i: DB'den okunur, Rules Engine'e verilir, commit edilir", async () => {
    const deps = makeDeps({ existingNodes: { [cloudNodeId]: cloudRepo }, txRevision: 1 });
    const service = new GraphService(deps.neo4j as any, deps.projectsRepo as any, deps.nodesRepo as any, deps.rulesEngine as any, deps.tabs as any);
    const result = await service.apply(projectId, {
      mutations: {
        nodes: [{ tempId: "t_svc", type: "Service", properties: svcProps("OrderSvc") }],
        edges: [{ sourceTempId: "t_svc", targetId: cloudNodeId, edgeType: "CALLS" }],
      },
    } as any);
    expect(result.success).toBe(true);
    if (result.success) expect(result.graphRevision).toBe(1);
    expect(deps.nodesRepo.getById).toHaveBeenCalledWith(projectId, cloudNodeId);
    expect(deps.rulesEngine.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ targetNode: cloudRepo }),
    );
    expect(deps.neo4j.write).toHaveBeenCalledOnce();
  });

  it("mevcut node id bulunamazsa → ERR_EDGE_NODE_NOT_FOUND + rollback", async () => {
    const deps = makeDeps(); // existingNodes boş
    const service = new GraphService(deps.neo4j as any, deps.projectsRepo as any, deps.nodesRepo as any, deps.rulesEngine as any, deps.tabs as any);
    const result = await service.apply(projectId, {
      mutations: {
        nodes: [{ tempId: "t_svc", type: "Service", properties: svcProps("OrderSvc") }],
        edges: [{ sourceTempId: "t_svc", targetId: cloudNodeId, edgeType: "CALLS" }],
      },
    } as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations.some((v) => v.code === "ERR_EDGE_NODE_NOT_FOUND")).toBe(true);
    }
    expect(deps.neo4j.write).not.toHaveBeenCalled();
  });

  it("edge merge cypher'ı idempotent (apoc.merge.relationship)", async () => {
    const deps = makeDeps({ existingNodes: { [cloudNodeId]: cloudRepo }, txRevision: 1 });
    const service = new GraphService(deps.neo4j as any, deps.projectsRepo as any, deps.nodesRepo as any, deps.rulesEngine as any, deps.tabs as any);
    await service.apply(projectId, {
      mutations: {
        nodes: [{ tempId: "t_svc", type: "Service", properties: svcProps("OrderSvc") }],
        edges: [{ sourceTempId: "t_svc", targetId: cloudNodeId, edgeType: "CALLS" }],
      },
    } as any);
    const edgeCypher = deps.txRun.mock.calls.map((c) => c[0]).find((c: string) => c.includes("relationship"));
    expect(edgeCypher).toContain("apoc.merge.relationship");
  });
});

describe("GraphService.apply — graf revizyon çatışması", () => {
  it("baseRevision eskidiyse hiçbir şey yazılmadan 409 ERR_GRAPH_REVISION_CONFLICT", async () => {
    const deps = makeDeps({ graphRevision: 5 });
    const service = new GraphService(deps.neo4j as any, deps.projectsRepo as any, deps.nodesRepo as any, deps.rulesEngine as any, deps.tabs as any);
    const err = await service
      .apply(projectId, {
        baseRevision: 3,
        mutations: { nodes: [{ tempId: "t_svc", type: "Service", properties: svcProps("OrderSvc") }], edges: [] },
      } as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: "ERR_GRAPH_REVISION_CONFLICT", currentRevision: 5 });
    expect(deps.neo4j.write).not.toHaveBeenCalled();
  });

  it("baseRevision güncel ise commit + yeni graphRevision döner", async () => {
    const deps = makeDeps({ graphRevision: 3, txRevision: 4 });
    const service = new GraphService(deps.neo4j as any, deps.projectsRepo as any, deps.nodesRepo as any, deps.rulesEngine as any, deps.tabs as any);
    const result = await service.apply(projectId, {
      baseRevision: 3,
      mutations: { nodes: [{ tempId: "t_svc", type: "Service", properties: svcProps("OrderSvc") }], edges: [] },
    } as any);
    expect(result.success).toBe(true);
    if (result.success) expect(result.graphRevision).toBe(4);
  });

  it("commit transaction'ında revizyon araya yazma ile eskidiyse rollback + 409", async () => {
    // Ön-kontrol geçer (graphRevision=3) ama tx içindeki atomik kontrol 0 kayıt döner.
    const deps = makeDeps({ graphRevision: 3, txRevision: undefined });
    const service = new GraphService(deps.neo4j as any, deps.projectsRepo as any, deps.nodesRepo as any, deps.rulesEngine as any, deps.tabs as any);
    await expect(
      service.apply(projectId, {
        baseRevision: 3,
        mutations: { nodes: [{ tempId: "t_svc", type: "Service", properties: svcProps("OrderSvc") }], edges: [] },
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("boş mutation no-op: bump yok, mevcut revizyon döner", async () => {
    const deps = makeDeps({ graphRevision: 7 });
    const service = new GraphService(deps.neo4j as any, deps.projectsRepo as any, deps.nodesRepo as any, deps.rulesEngine as any, deps.tabs as any);
    const result = await service.apply(projectId, { mutations: { nodes: [], edges: [] } } as any);
    expect(result.success).toBe(true);
    if (result.success) expect(result.graphRevision).toBe(7);
    expect(deps.neo4j.write).not.toHaveBeenCalled();
  });
});
