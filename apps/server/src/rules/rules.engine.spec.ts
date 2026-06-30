import { describe, it, expect, vi, beforeEach } from "vitest";
import { RulesEngine } from "./rules.engine";
import { CircularDependencyChecker } from "./checkers/circular-dependency.checker";
import { TypeMismatchChecker } from "./checkers/type-mismatch.checker";
import { EmptySchemaChecker } from "./checkers/empty-schema.checker";
import type { StoredNode } from "../nodes/nodes.repository";
import type { EvaluationContext } from "./types";

function makeNode(type: string, id: string, properties: any = {}): StoredNode {
  return {
    id,
    type: type as any,
    projectId: "p1",
    positionX: 0,
    positionY: 0,
    createdAt: "2026-05-22T10:00:00.000Z",
    updatedAt: "2026-05-22T10:00:00.000Z",
    properties,
  };
}

function ctx(source: StoredNode, edgeKind: any, target: StoredNode): EvaluationContext {
  return { projectId: "p1", sourceNode: source, targetNode: target, edgeKind };
}

describe("RulesEngine", () => {
  let engine: RulesEngine;
  let circular: CircularDependencyChecker;

  beforeEach(() => {
    circular = { check: vi.fn(async () => ({ allowed: true })) } as any;
    const typeMismatch = new TypeMismatchChecker();
    const emptySchema = new EmptySchemaChecker();
    engine = new RulesEngine(circular, typeMismatch, emptySchema);
  });

  describe("whitelist", () => {
    it("Controller → CALLS → Service izinli", async () => {
      const r = await engine.evaluate(ctx(makeNode("Controller", "c1"), "CALLS", makeNode("Service", "s1")));
      expect(r.allowed).toBe(true);
    });

    it("Service → CALLS → Repository izinli", async () => {
      const r = await engine.evaluate(ctx(makeNode("Service", "s1"), "CALLS", makeNode("Repository", "r1")));
      expect(r.allowed).toBe(true);
    });

    it("Repository → QUERIES → Table izinli (Columns dolu)", async () => {
      const r = await engine.evaluate(ctx(
        makeNode("Repository", "r1"),
        "QUERIES",
        makeNode("Table", "t1", { Columns: [{ Name: "id" }] }),
      ));
      expect(r.allowed).toBe(true);
    });

    it("Service → IMPLEMENTS → Service izinli (arayüz/kontrat)", async () => {
      const r = await engine.evaluate(ctx(makeNode("Service", "s1"), "IMPLEMENTS", makeNode("Service", "s2")));
      expect(r.allowed).toBe(true);
    });
  });

  describe("blacklist", () => {
    it("ERR_001: FrontendApp → REQUESTS → Table", async () => {
      const r = await engine.evaluate(ctx(makeNode("FrontendApp", "f1"), "REQUESTS", makeNode("Table", "t1")));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("ERR_001");
    });

    it("ERR_002: Controller → WRITES → Table", async () => {
      const r = await engine.evaluate(ctx(makeNode("Controller", "c1"), "WRITES", makeNode("Table", "t1")));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("ERR_002");
    });

    it("ERR_003: Table → USES → Service (veri pasiftir)", async () => {
      const r = await engine.evaluate(ctx(makeNode("Table", "t1"), "USES", makeNode("Service", "s1")));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("ERR_003");
    });

    it("ERR_004: DTO → HAS → Model", async () => {
      const r = await engine.evaluate(ctx(makeNode("DTO", "d1"), "HAS", makeNode("Model", "m1")));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("ERR_004");
    });

    it("ERR_005: Service → REQUESTS → FrontendApp", async () => {
      const r = await engine.evaluate(ctx(makeNode("Service", "s1"), "REQUESTS", makeNode("FrontendApp", "f1")));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("ERR_005");
    });

    it("ERR_006: APIGateway → ROUTES_TO → Repository", async () => {
      const r = await engine.evaluate(ctx(makeNode("APIGateway", "g1"), "ROUTES_TO", makeNode("Repository", "r1")));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("ERR_006");
    });

    it("ERR_007: EventHandler → RETURNS → DTO", async () => {
      const r = await engine.evaluate(ctx(makeNode("EventHandler", "e1"), "RETURNS", makeNode("DTO", "d1")));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("ERR_007");
    });
  });

  describe("default deny (whitelist match yok + blacklist match yok)", () => {
    it("Worker → REQUESTS → ExternalService → ERR_NOT_WHITELISTED", async () => {
      // Worker'ın REQUESTS edge'i whitelist'te yok ve blacklist'e de takılmıyor.
      const r = await engine.evaluate(ctx(makeNode("Worker", "w1"), "REQUESTS", makeNode("ExternalService", "x1")));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("ERR_NOT_WHITELISTED");
    });

    it("Controller → IMPLEMENTS → Service → ERR_NOT_WHITELISTED (yalnız Service→Service izinli)", async () => {
      const r = await engine.evaluate(ctx(makeNode("Controller", "c1"), "IMPLEMENTS", makeNode("Service", "s1")));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("ERR_NOT_WHITELISTED");
    });
  });

  describe("conditional", () => {
    it("ERR_COND_002: Controller (UserDTO) → Service (OrderDTO)", async () => {
      const ctrl = makeNode("Controller", "c1", {
        Endpoints: [{ HttpMethod: "POST", Route: "/", RequestDTORef: "UserDTO", RequiresAuth: false }],
      });
      const srv = makeNode("Service", "s1", {
        Methods: [{ MethodName: "doX", Parameters: [{ Name: "p", Type: "OrderDTO" }], ReturnType: "void" }],
      });
      const r = await engine.evaluate(ctx(ctrl, "CALLS", srv));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("ERR_COND_002");
    });

    it("Controller (UserDTO) → Service (UserDTO) izinli", async () => {
      const ctrl = makeNode("Controller", "c1", {
        Endpoints: [{ HttpMethod: "POST", Route: "/", RequestDTORef: "UserDTO", RequiresAuth: false }],
      });
      const srv = makeNode("Service", "s1", {
        Methods: [{ MethodName: "doX", Parameters: [{ Name: "p", Type: "UserDTO" }], ReturnType: "void" }],
      });
      const r = await engine.evaluate(ctx(ctrl, "CALLS", srv));
      expect(r.allowed).toBe(true);
    });

    it("WARN_COND_001: Repository → QUERIES → empty Table", async () => {
      const r = await engine.evaluate(ctx(
        makeNode("Repository", "r1"),
        "QUERIES",
        makeNode("Table", "t1", { Columns: [], TableName: "empty_t" }),
      ));
      expect(r.allowed).toBe(true);
      expect(r.severity).toBe("warning");
      expect(r.code).toBe("WARN_COND_001");
    });

    it("ERR_COND_001 circular checker'a delege eder", async () => {
      circular.check = vi.fn(async () => ({
        allowed: false,
        code: "ERR_COND_001",
        severity: "error",
        ruleViolated: "CIRCULAR_DEPENDENCY",
        message: "döngü",
      }));
      const r = await engine.evaluate(ctx(makeNode("Service", "a"), "CALLS", makeNode("Service", "b")));
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("ERR_COND_001");
    });
  });

  describe("rulesFor* + catalog", () => {
    it("rulesForNodeKind('Service') allowAsSource/Target listeleri döner", () => {
      const r = engine.rulesForNodeKind("Service");
      expect(r.allowAsSource.length).toBeGreaterThan(0);
      expect(r.allowAsTarget.length).toBeGreaterThan(0);
    });

    it("rulesForEdgeKind('CALLS') deny listesi içerir", () => {
      const r = engine.rulesForEdgeKind("CALLS");
      // ERR_006 APIGateway CALLS Repository — deny rule
      expect(r.deny.some((d) => d.code === "ERR_006")).toBe(true);
    });

    it("catalog() whitelist/blacklist/conditional sayıları döner", () => {
      const c = engine.catalog();
      expect(c.whitelist.length).toBeGreaterThanOrEqual(30);
      expect(c.blacklist.length).toBe(7);
      expect(c.conditional.length).toBe(3);
      expect(c.defaults.unmatchedBehavior).toBe("deny");
    });
  });
});
