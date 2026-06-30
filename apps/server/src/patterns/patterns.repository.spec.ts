import { describe, it, expect, vi } from "vitest";
import { PatternsRepository } from "./patterns.repository";

const neo4j = { run: vi.fn() };
const repo = new PatternsRepository(neo4j as any);

const props = {
  id: "1", name: "n", description: "d", tags: [],
  graphJson: '{"nodes":[{"tempId":"t","type":"Controller","properties":{}}],"edges":[]}',
  source: "seed", createdAt: "2026-05-22T00:00:00.000Z",
};

describe("PatternsRepository", () => {
  it("search vektör index'i çağırır ve hit map'ler", async () => {
    neo4j.run.mockResolvedValueOnce({
      records: [{ get: (k: string) => (k === "score" ? 0.91 : { properties: props }) }],
    });
    const hits = await repo.search([0.1, 0.2], 3, 0.7);
    expect(hits[0].score).toBe(0.91);
    expect(hits[0].pattern.graph.nodes).toHaveLength(1);
    expect(neo4j.run.mock.calls[0][0]).toContain("db.index.vector.queryNodes");
    expect(neo4j.run.mock.calls[0][1]).toEqual({ k: 3, embedding: [0.1, 0.2], minScore: 0.7 });
  });

  it("getById yoksa null döner", async () => {
    neo4j.run.mockResolvedValueOnce({ records: [] });
    expect(await repo.getById("x")).toBeNull();
  });

  it("list summary (nodeCount/edgeCount) döner", async () => {
    neo4j.run.mockResolvedValueOnce({ records: [{ get: () => ({ properties: props }) }] });
    const list = await repo.list();
    expect(list[0].nodeCount).toBe(1);
    expect(list[0].edgeCount).toBe(0);
  });
});
