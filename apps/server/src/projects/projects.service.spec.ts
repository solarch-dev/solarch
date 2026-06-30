import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProjectsService } from "./projects.service";
import type { StoredProject } from "./projects.repository";

function makeRepo(initial: StoredProject[] = []) {
  const store = new Map<string, StoredProject>(initial.map((p) => [p.id, p]));
  return {
    store,
    create: vi.fn(async (p: StoredProject) => { store.set(p.id, p); }),
    getById: vi.fn(async (id: string) => store.get(id) ?? null),
    // Scope filters like the real repo: personal projects match ownerId when no org.
    list: vi.fn(async (scope?: { userId?: string; orgId?: string | null }) =>
      [...store.values()].filter((p) =>
        scope?.orgId ? p.orgId === scope.orgId : scope?.userId ? p.ownerId === scope.userId && p.orgId == null : true,
      ),
    ),
    update: vi.fn(async (id: string, upd: any) => {
      const ex = store.get(id);
      if (!ex) return null;
      const next = { ...ex, ...upd };
      store.set(id, next);
      return next;
    }),
    delete: vi.fn(async (id: string) => store.delete(id)),
    exists: vi.fn(async (id: string) => store.has(id)),
    counts: vi.fn(async () => ({ nodes: 2, edges: 1 })),
    getGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
    getGraphRevision: vi.fn(async () => 0),
    setImplementation: vi.fn(async (_id: string, entries: unknown[]) => entries.length),
    reassignOwner: vi.fn(async (id: string, ownerId: string, orgId: string | null) => {
      const ex = store.get(id);
      if (ex) store.set(id, { ...ex, ownerId, orgId });
    }),
  };
}

function ownProject(id = "ip-1"): StoredProject {
  return {
    id,
    name: "Project",
    description: "",
    status: "draft",
    ownerId: "user_1",
    orgId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("ProjectsService", () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: ProjectsService;

  const tabs = { ensureDefault: vi.fn(async () => ({ id: "t" })) };
  const auth = { userId: "user_1", orgId: null, orgRole: null };

  beforeEach(() => {
    repo = makeRepo();
    service = new ProjectsService(repo as any, tabs as any);
  });

  it("create generates id + zero counts + stamps ownership", async () => {
    const p = await service.create({ name: "X", description: "d", status: "draft" } as any, auth);
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.counts).toEqual({ nodes: 0, edges: 0 });
    expect(p.ownerId).toBe("user_1");
    expect(p.orgId).toBeNull();
  });

  it("create works with name only (description/status defaults)", async () => {
    const p = await service.create({ name: "Restaurant", description: "", status: "draft" } as any, auth);
    expect(p.name).toBe("Restaurant");
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("getById missing → ERR_PROJECT_NOT_FOUND", async () => {
    await expect(service.getById("00000000-0000-0000-0000-000000000000", auth))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("getById found → returns with counts", async () => {
    const created = await service.create({ name: "X", description: "d", status: "active" } as any, auth);
    const got = await service.getById(created.id, auth);
    expect(got.counts).toEqual({ nodes: 2, edges: 1 });
  });

  it("other user cannot access → ERR_PROJECT_FORBIDDEN", async () => {
    const created = await service.create({ name: "X", description: "d", status: "draft" } as any, auth);
    const other = { userId: "user_2", orgId: null, orgRole: null };
    await expect(service.getById(created.id, other)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("update missing → NotFound", async () => {
    await expect(service.update("00000000-0000-0000-0000-000000000000", { name: "Z" }, auth))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("delete missing → NotFound", async () => {
    await expect(service.delete("00000000-0000-0000-0000-000000000000", auth))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("delete found → resolves", async () => {
    const created = await service.create({ name: "X", description: "d", status: "draft" } as any, auth);
    await expect(service.delete(created.id, auth)).resolves.toBeUndefined();
  });

  it("getGraph returns project + nodes + edges + counts", async () => {
    const created = await service.create({ name: "X", description: "d", status: "draft" } as any, auth);
    const g = await service.getGraph(created.id, auth);
    expect(g.project.id).toBe(created.id);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.counts).toEqual({ nodes: 0, edges: 0 });
  });

  describe("reportImplementation", () => {
    const entries = [{ nodeId: "11111111-1111-4111-8111-111111111111", total: 3, filled: 2, filledAi: 1 }];

    it("writes counts to repo and returns updated", async () => {
      repo = makeRepo([ownProject()]);
      service = new ProjectsService(repo as any, tabs as any);
      const result = await service.reportImplementation("ip-1", entries, auth);
      expect(result).toEqual({ updated: 1 });
      expect(repo.setImplementation).toHaveBeenCalledWith("ip-1", entries);
    });

    it("empty report is no-op (does not hit repo)", async () => {
      repo = makeRepo([ownProject()]);
      service = new ProjectsService(repo as any, tabs as any);
      const result = await service.reportImplementation("ip-1", [], auth);
      expect(result).toEqual({ updated: 0 });
      expect(repo.setImplementation).not.toHaveBeenCalled();
    });

    it("cannot report to another user's project → 403", async () => {
      repo = makeRepo([{ ...ownProject(), ownerId: "user_2" }]);
      service = new ProjectsService(repo as any, tabs as any);
      await expect(service.reportImplementation("ip-1", entries, auth))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it("missing project → 404", async () => {
      await expect(service.reportImplementation("ghost", entries, auth))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
