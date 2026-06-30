import { describe, it, expect, vi } from "vitest";
import { PatternsService } from "./patterns.service";

const graph = { nodes: [{ tempId: "t", type: "Controller", properties: {} }], edges: [] };

function make(embConfigured = true) {
  const repo = {
    create: vi.fn(), list: vi.fn(), getById: vi.fn(),
    delete: vi.fn(), search: vi.fn().mockResolvedValue([]),
  };
  const projectsRepo = { getById: vi.fn(), getGraph: vi.fn() };
  const embeddings = {
    isConfigured: () => embConfigured,
    embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    embedBatch: vi.fn(),
  };
  return { svc: new PatternsService(repo as any, projectsRepo as any, embeddings as any), repo, projectsRepo, embeddings };
}

describe("PatternsService", () => {
  it("create embed edip repo.create çağırır", async () => {
    const { svc, repo, embeddings } = make();
    await svc.create({ name: "n", description: "d", tags: [], graph } as any);
    expect(embeddings.embed).toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "n", source: "seed" }),
      [0.1, 0.2],
    );
  });

  it("embedding yoksa search boş döner (degrade)", async () => {
    const { svc, embeddings } = make(false);
    expect(await svc.search("x", 3, 0.7)).toEqual([]);
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it("embedding yoksa create 503 fırlatır", async () => {
    const { svc } = make(false);
    await expect(svc.create({ name: "n", description: "d", tags: [], graph } as any)).rejects.toThrow();
  });

  it("promote: olmayan proje 404", async () => {
    const { svc, projectsRepo } = make();
    projectsRepo.getById.mockResolvedValue(null);
    await expect(svc.promoteFromProject("p", { name: "n", description: "d" })).rejects.toThrow();
  });

  it("promote: tüm proje grafiğini tempId'leyip create eder", async () => {
    const { svc, projectsRepo, repo } = make();
    projectsRepo.getById.mockResolvedValue({ id: "p" });
    projectsRepo.getGraph.mockResolvedValue({
      nodes: [{ id: "n1", type: "Controller", properties: { ControllerName: "X" } }],
      edges: [{ sourceNodeId: "n1", targetNodeId: "n1", kind: "CALLS", properties: {} }],
    });
    await svc.promoteFromProject("p", { name: "P", description: "d" });
    const stored = repo.create.mock.calls[0][0];
    expect(stored.source).toBe("promoted");
    expect(stored.graph.nodes[0].tempId).toMatch(/^t_0_/);
    expect(stored.graph.edges[0].sourceTempId).toBe(stored.graph.nodes[0].tempId);
  });
});
