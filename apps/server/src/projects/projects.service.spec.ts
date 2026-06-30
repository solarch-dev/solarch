import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProjectsService } from "./projects.service";
import type { StoredProject } from "./projects.repository";

// Claim testleri için deterministik bilet: "valid-guest-token" → guest_g1.
vi.mock("../auth/guest-token", () => ({
  verifyGuestToken: (token: string) =>
    token === "valid-guest-token" ? { guestId: "guest_g1", expiresAt: Date.now() + 1000 } : null,
}));

function makeRepo(initial: StoredProject[] = []) {
  const store = new Map<string, StoredProject>(initial.map((p) => [p.id, p]));
  return {
    store,
    create: vi.fn(async (p: StoredProject) => { store.set(p.id, p); }),
    getById: vi.fn(async (id: string) => store.get(id) ?? null),
    // Gerçek repo gibi kapsam filtreler: org yoksa ownerId eşleşen kişisel projeler.
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

function guestProject(id = "gp-1"): StoredProject {
  return {
    id,
    name: "Guest sketch",
    description: "",
    status: "draft",
    ownerId: "guest_g1",
    orgId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("ProjectsService", () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: ProjectsService;

  const tabs = { ensureDefault: vi.fn(async () => ({ id: "t" })) };
  const billing = { assertProjectCap: vi.fn(async () => {}) };
  const auth = { userId: "user_1", orgId: null, orgRole: null };

  beforeEach(() => {
    repo = makeRepo();
    service = new ProjectsService(repo as any, tabs as any, billing as any);
  });

  it("create id üretir + counts sıfır + sahiplik damgalanır", async () => {
    const p = await service.create({ name: "X", description: "d", status: "draft" } as any, auth);
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.counts).toEqual({ nodes: 0, edges: 0 });
    expect(p.ownerId).toBe("user_1");
    expect(p.orgId).toBeNull();
  });

  it("create sadece name ile çalışır (description/status default)", async () => {
    const p = await service.create({ name: "Restoran", description: "", status: "draft" } as any, auth);
    expect(p.name).toBe("Restoran");
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("getById yok → ERR_PROJECT_NOT_FOUND", async () => {
    await expect(service.getById("00000000-0000-0000-0000-000000000000", auth))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("getById var → counts ile döner", async () => {
    const created = await service.create({ name: "X", description: "d", status: "active" } as any, auth);
    const got = await service.getById(created.id, auth);
    expect(got.counts).toEqual({ nodes: 2, edges: 1 });
  });

  it("başka kullanıcı erişemez → ERR_PROJECT_FORBIDDEN", async () => {
    const created = await service.create({ name: "X", description: "d", status: "draft" } as any, auth);
    const other = { userId: "user_2", orgId: null, orgRole: null };
    await expect(service.getById(created.id, other)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("update yok → NotFound", async () => {
    await expect(service.update("00000000-0000-0000-0000-000000000000", { name: "Z" }, auth))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("delete yok → NotFound", async () => {
    await expect(service.delete("00000000-0000-0000-0000-000000000000", auth))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("delete var → resolve", async () => {
    const created = await service.create({ name: "X", description: "d", status: "draft" } as any, auth);
    await expect(service.delete(created.id, auth)).resolves.toBeUndefined();
  });

  it("getGraph project + nodes + edges + counts döner", async () => {
    const created = await service.create({ name: "X", description: "d", status: "draft" } as any, auth);
    const g = await service.getGraph(created.id, auth);
    expect(g.project.id).toBe(created.id);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.counts).toEqual({ nodes: 0, edges: 0 });
  });

  describe("claimGuestProjects", () => {
    it("geçerli bilet → misafir projesi kullanıcıya devredilir", async () => {
      repo = makeRepo([guestProject()]);
      service = new ProjectsService(repo as any, tabs as any, billing as any);
      const claimed = await service.claimGuestProjects("valid-guest-token", auth);
      expect(claimed).toHaveLength(1);
      expect(claimed[0].ownerId).toBe("user_1");
      expect(repo.reassignOwner).toHaveBeenCalledWith("gp-1", "user_1", null);
      expect(repo.store.get("gp-1")!.ownerId).toBe("user_1");
    });

    it("devir kullanıcının plan limitine sayılır (cap kontrolü çağrılır)", async () => {
      repo = makeRepo([guestProject()]);
      service = new ProjectsService(repo as any, tabs as any, billing as any);
      await service.claimGuestProjects("valid-guest-token", auth);
      // mine(0) + guest(1) - 1 = 0 → assertProjectCap("user_1", 0)
      expect(billing.assertProjectCap).toHaveBeenCalledWith("user_1", 0);
    });

    it("geçersiz bilet → sessizce boş liste", async () => {
      const claimed = await service.claimGuestProjects("bogus", auth);
      expect(claimed).toEqual([]);
      expect(repo.reassignOwner).not.toHaveBeenCalled();
    });

    it("bilet geçerli ama misafir projesi yok → boş liste", async () => {
      const claimed = await service.claimGuestProjects("valid-guest-token", auth);
      expect(claimed).toEqual([]);
    });

    it("misafir misafirden devralamaz → 403", async () => {
      const guestAuth = { userId: "guest_g2", orgId: null, orgRole: null, isGuest: true };
      await expect(service.claimGuestProjects("valid-guest-token", guestAuth))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("reportImplementation", () => {
    const own = (): StoredProject => ({ ...guestProject("ip-1"), ownerId: "user_1" });
    const entries = [{ nodeId: "11111111-1111-4111-8111-111111111111", total: 3, filled: 2, filledAi: 1 }];

    it("sayaçları repo'ya yazar ve updated döner", async () => {
      repo = makeRepo([own()]);
      service = new ProjectsService(repo as any, tabs as any, billing as any);
      const result = await service.reportImplementation("ip-1", entries, auth);
      expect(result).toEqual({ updated: 1 });
      expect(repo.setImplementation).toHaveBeenCalledWith("ip-1", entries);
    });

    it("boş rapor no-op'tur (repo'ya inmez)", async () => {
      repo = makeRepo([own()]);
      service = new ProjectsService(repo as any, tabs as any, billing as any);
      const result = await service.reportImplementation("ip-1", [], auth);
      expect(result).toEqual({ updated: 0 });
      expect(repo.setImplementation).not.toHaveBeenCalled();
    });

    it("başkasının projesine rapor yazılamaz → 403", async () => {
      repo = makeRepo([{ ...own(), ownerId: "user_2" }]);
      service = new ProjectsService(repo as any, tabs as any, billing as any);
      await expect(service.reportImplementation("ip-1", entries, auth))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it("olmayan proje → 404", async () => {
      await expect(service.reportImplementation("ghost", entries, auth))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
