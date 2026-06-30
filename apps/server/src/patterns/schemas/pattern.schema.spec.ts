import { describe, it, expect } from "vitest";
import { CreatePatternSchema, PatternGraphSchema } from "./pattern.schema";

const graph = {
  nodes: [{ tempId: "t_ctrl", type: "Controller", properties: { ControllerName: "X" } }],
  edges: [],
};

describe("CreatePatternSchema", () => {
  it("geçerli pattern'i parse eder, tags default boş", () => {
    const p = CreatePatternSchema.parse({ name: "n", description: "d", graph });
    expect(p.tags).toEqual([]);
    expect(p.graph.nodes).toHaveLength(1);
    expect(p.graph.edges).toEqual([]);
  });

  it("graph.nodes boşsa fırlatır", () => {
    expect(() => PatternGraphSchema.parse({ nodes: [], edges: [] })).toThrow();
  });

  it("geçerli edgeType ile edge kabul eder", () => {
    const g = PatternGraphSchema.parse({
      nodes: graph.nodes,
      edges: [{ sourceTempId: "a", targetTempId: "b", edgeType: "CALLS" }],
    });
    expect(g.edges[0].edgeType).toBe("CALLS");
  });

  it("geçersiz edgeType reddeder", () => {
    expect(() => PatternGraphSchema.parse({
      nodes: graph.nodes,
      edges: [{ sourceTempId: "a", targetTempId: "b", edgeType: "BOGUS" }],
    })).toThrow();
  });

  it("bilinmeyen üst alanı reddeder (strict)", () => {
    expect(() => CreatePatternSchema.parse({ name: "n", description: "d", graph, extra: 1 })).toThrow();
  });
});
