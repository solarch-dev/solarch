import { describe, it, expect, vi, beforeEach } from "vitest";
import { TabsRepository } from "./tabs.repository";

const neo4j = { run: vi.fn() };
const repo = new TabsRepository(neo4j as any);

describe("TabsRepository", () => {
  beforeEach(() => neo4j.run.mockReset());

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
