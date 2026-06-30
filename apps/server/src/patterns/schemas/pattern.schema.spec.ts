import { describe, it, expect } from "vitest";
import { CreatePatternSchema, PatternGraphSchema } from "./pattern.schema";

const graph = {
  nodes: [{ tempId: "t_ctrl", type: "Controller", properties: { ControllerName: "X" } }],
  edges: [],
};

describe("CreatePatternSchema", () => {
  it("parses valid pattern, tags default empty", () => {
    const p = CreatePatternSchema.parse({ name: "n", description: "d", graph });
    expect(p.tags).toEqual([]);
    expect(p.graph.nodes).toHaveLength(1);
    expect(p.graph.edges).toEqual([]);
  });

  it("throws when graph.nodes is empty", () => {
    expect(() => PatternGraphSchema.parse({ nodes: [], edges: [] })).toThrow();
  });

  it("accepts edge with valid edgeType", () => {
    const g = PatternGraphSchema.parse({
      nodes: graph.nodes,
      edges: [{ sourceTempId: "a", targetTempId: "b", edgeType: "CALLS" }],
    });
    expect(g.edges[0].edgeType).toBe("CALLS");
  });

  it("rejects invalid edgeType", () => {
    expect(() => PatternGraphSchema.parse({
      nodes: graph.nodes,
      edges: [{ sourceTempId: "a", targetTempId: "b", edgeType: "BOGUS" }],
    })).toThrow();
  });

  it("rejects unknown top-level field (strict)", () => {
    expect(() => CreatePatternSchema.parse({ name: "n", description: "d", graph, extra: 1 })).toThrow();
  });
});
