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

  it("listAll 21 tipi döner (19 + Phase 2A: APIGateway, Orchestrator)", () => {
    const list = service.listAll();
    expect(list).toHaveLength(21);
    const ids = list.map((t) => t.id);
    expect(ids).toContain("Table");
    expect(ids).toContain("Service");
    expect(ids).toContain("Module");
    expect(ids).toContain("APIGateway");
    expect(ids).toContain("Orchestrator");
  });

  it("listAll'da her tip family + nameKey içerir", () => {
    const list = service.listAll();
    for (const t of list) {
      expect(t.family).toBeDefined();
      expect(t.familyLabel).toBeDefined();
      expect(t.nameKey).toMatch(/^[A-Z]/);
    }
  });

  it("getById Table için JSON Schema döner", () => {
    const detail = service.getById("Table");
    expect(detail.id).toBe("Table");
    expect(detail.nameKey).toBe("TableName");
    expect(detail.schema).toBeDefined();
  });

  it("getById Table fieldHints döner (PK/FK badge)", () => {
    const d = service.getById("Table") as any;
    expect(d.fieldHints["Columns.IsPrimaryKey"].badge).toBe("PK");
    expect(d.fieldHints["ForeignKeys"].badge).toBe("FK");
    expect(d.fieldHints["Indexes"].group).toBe("performance");
  });

  it("getById Enum fieldHints döner", () => {
    expect((service.getById("Enum") as any).fieldHints["Values"].badge).toBe("ENUM");
  });

  it("getById Faz B fieldHints döner (Service DI, Controller AUTH)", () => {
    expect((service.getById("Service") as any).fieldHints["Dependencies"].badge).toBe("DI");
    expect((service.getById("Controller") as any).fieldHints["Endpoints.RequiresAuth"].badge).toBe("AUTH");
    expect((service.getById("Worker") as any).fieldHints["RetryPolicy"].badge).toBe("RETRY");
  });

  it("getById Faz C fieldHints döner (Cache TTL, EnvVar SECRET, Module DEP)", () => {
    expect((service.getById("Cache") as any).fieldHints["TTL_Seconds"].badge).toBe("TTL");
    expect((service.getById("EnvironmentVariable") as any).fieldHints["IsSecret"].badge).toBe("SECRET");
    expect((service.getById("Module") as any).fieldHints["Dependencies"].badge).toBe("DEP");
    // Tüm 21 tip için fieldHints artık dolu (boş tip kalmadı).
    for (const t of service.listAll()) {
      expect(Object.keys((service.getById(t.id) as any).fieldHints).length).toBeGreaterThan(0);
    }
  });

  it("getById bilinmeyen id'de NotFoundException fırlatır", () => {
    expect(() => service.getById("Foo")).toThrow(NotFoundException);
  });

  it("getRulesById engine'den allow/deny listelerini döner", () => {
    const r = service.getRulesById("Table");
    expect(r.id).toBe("Table");
    expect(r.allowAsSource).toBeDefined();
    expect(r.allowAsTarget).toBeDefined();
    expect(r.denyAsSource).toBeDefined();
    expect(r.denyAsTarget).toBeDefined();
  });

  it("getRulesById bilinmeyen id'de NotFoundException", () => {
    expect(() => service.getRulesById("Foo")).toThrow(NotFoundException);
  });
});
