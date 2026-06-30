import { describe, it, expect, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { EdgeTypesService } from "./edge-types.service";

describe("EdgeTypesService", () => {
  const mockEngine = {
    rulesForEdgeKind: vi.fn(() => ({ allow: [], deny: [] })),
  };
  const service = new EdgeTypesService(mockEngine as any);

it("listAll returns 16 edge type", () => {
    const list = service.listAll();
    expect(list).toHaveLength(16);
    const ids = list.map((t) => t.id);
    expect(ids).toContain("CALLS");
    expect(ids).toContain("PUBLISHES");
    expect(ids).toContain("ROUTES_TO");
  });

it("getById returns family + description for CALLS", () => {
    const d = service.getById("CALLS");
    expect(d.family).toBe("communication");
    expect(d.familyLabel).toContain("Communication");
  });

  it("getById bilinmeyen id'de NotFoundException", () => {
    expect(() => service.getById("FOO")).toThrow(NotFoundException);
  });

it("getRulesById engine returns allow + deny list", () => {
    const r = service.getRulesById("CALLS");
    expect(r.allow).toBeDefined();
    expect(r.deny).toBeDefined();
  });
});
