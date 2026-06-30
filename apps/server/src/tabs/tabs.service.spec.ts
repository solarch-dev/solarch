import { describe, it, expect, vi } from "vitest";
import { TabsService } from "./tabs.service";

function make() {
  const repo = {
    findDefault: vi.fn(), create: vi.fn(), list: vi.fn(), getById: vi.fn(),
    update: vi.fn(), deleteAndReassign: vi.fn(), maxOrder: vi.fn().mockResolvedValue(0),
    projectExists: vi.fn().mockResolvedValue(true), nodeExists: vi.fn().mockResolvedValue(true),
    upsertReference: vi.fn(), removeReference: vi.fn(), nodeHomeTab: vi.fn(), tabGraph: vi.fn(),
  };
  return { svc: new TabsService(repo as any), repo };
}

describe("TabsService", () => {
  it("ensureDefault does not create when one exists", async () => {
    const { svc, repo } = make();
    repo.findDefault.mockResolvedValue({ id: "d", isDefault: true });
    await svc.ensureDefault("p");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("ensureDefault creates Main Architecture when missing", async () => {
    const { svc, repo } = make();
    repo.findDefault.mockResolvedValue(null);
    const t = await svc.ensureDefault("p");
    expect(t.name).toBe("Main Architecture");
    expect(t.isDefault).toBe(true);
    expect(repo.create).toHaveBeenCalled();
  });

  it("default tab cannot be deleted", async () => {
    const { svc, repo } = make();
    repo.getById.mockResolvedValue({ id: "d", isDefault: true });
    await expect(svc.delete("p", "d")).rejects.toThrow();
  });

  it("node cannot reference its own home tab", async () => {
    const { svc, repo } = make();
    repo.getById.mockResolvedValue({ id: "t1", isDefault: false });
    repo.nodeHomeTab.mockResolvedValue("t1");
    await expect(svc.addReference("p", "t1", "n", 0, 0)).rejects.toThrow();
  });

  it("addReference upserts on a different home tab", async () => {
    const { svc, repo } = make();
    repo.getById.mockResolvedValue({ id: "t2", isDefault: false });
    repo.nodeHomeTab.mockResolvedValue("t1");
    await svc.addReference("p", "t2", "n", 5, 6);
    expect(repo.upsertReference).toHaveBeenCalledWith("p", "t2", "n", 5, 6);
  });
});
