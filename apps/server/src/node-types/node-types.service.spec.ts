import { describe, it, expect, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { NodeTypesService } from "./node-types.service";

describe("NodeTypesService", () => {
  const mockEngine = {
    rulesForNodeKind: vi.fn(() => ({
      allowAsSource: [], allowAsTarget: [], denyAsSource: [], denyAsTarget: [],
    })),
  };
  const service = new NodeTypesService(mockEngine as any);

  it("listAll returns 21 types (19 + Phase 2A: APIGateway, Orchestrator)", () => {
    const list = service.listAll();
    expect(list).toHaveLength(21);
    const ids = list.map((t) => t.id);
    expect(ids).toContain("Table");
    expect(ids).toContain("Service");
    expect(ids).toContain("Module");
    expect(ids).toContain("APIGateway");
    expect(ids).toContain("Orchestrator");
  });

  it("listAll includes family + nameKey for each type", () => {
    const list = service.listAll();
    for (const t of list) {
      expect(t.family).toBeDefined();
      expect(t.familyLabel).toBeDefined();
      expect(t.nameKey).toMatch(/^[A-Z]/);
    }
  });

  it("getById returns JSON Schema for Table", () => {
    const detail = service.getById("Table");
    expect(detail.id).toBe("Table");
    expect(detail.nameKey).toBe("TableName");
    expect(detail.schema).toBeDefined();
  });

  it("getById returns Table fieldHints (PK/FK badge)", () => {
    const d = service.getById("Table") as any;
    expect(d.fieldHints["Columns.IsPrimaryKey"].badge).toBe("PK");
    expect(d.fieldHints["ForeignKeys"].badge).toBe("FK");
    expect(d.fieldHints["Indexes"].group).toBe("performance");
  });

  it("getById returns Enum fieldHints", () => {
    expect((service.getById("Enum") as any).fieldHints["Values"].badge).toBe("ENUM");
  });

  it("getById returns Phase B fieldHints (Service DI, Controller AUTH)", () => {
    expect((service.getById("Service") as any).fieldHints["Dependencies"].badge).toBe("DI");
    expect((service.getById("Controller") as any).fieldHints["Endpoints.RequiresAuth"].badge).toBe("AUTH");
    expect((service.getById("Worker") as any).fieldHints["RetryPolicy"].badge).toBe("RETRY");
  });

  it("getById returns Phase C fieldHints (Cache TTL, EnvVar SECRET, Module DEP)", () => {
    expect((service.getById("Cache") as any).fieldHints["TTL_Seconds"].badge).toBe("TTL");
    expect((service.getById("EnvironmentVariable") as any).fieldHints["IsSecret"].badge).toBe("SECRET");
    expect((service.getById("Module") as any).fieldHints["Dependencies"].badge).toBe("DEP");
    // fieldHints now populated for all 21 types (no empty type left).
    for (const t of service.listAll()) {
      expect(Object.keys((service.getById(t.id) as any).fieldHints).length).toBeGreaterThan(0);
    }
  });

  it("getById throws NotFoundException for unknown id", () => {
    expect(() => service.getById("Foo")).toThrow(NotFoundException);
  });

  it("getRulesById returns allow/deny lists from engine", () => {
    const r = service.getRulesById("Table");
    expect(r.id).toBe("Table");
    expect(r.allowAsSource).toBeDefined();
    expect(r.allowAsTarget).toBeDefined();
    expect(r.denyAsSource).toBeDefined();
    expect(r.denyAsTarget).toBeDefined();
  });

  it("getRulesById throws NotFoundException for unknown id", () => {
    expect(() => service.getRulesById("Foo")).toThrow(NotFoundException);
  });
});
