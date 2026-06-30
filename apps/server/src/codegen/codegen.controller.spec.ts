import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { CodegenController } from "./codegen.controller";
import { CODEGEN_VERSION } from "./codegen.version";
import type { GeneratedProject } from "./types";

/* ────────────────────────────────────────────────────────────────────────
 * codegen.controller.spec.ts — sürüm damgalama + status birim testleri.
 *
 *   - generate başarılı -> billing.assertCanGenerateCode + service.generate +
 *     projects.setCodegenVersion(projectId, CODEGEN_VERSION) ÇAĞRILIR (damga).
 *   - status: generated null / eski / güncel / proje yok kombinasyonlarında
 *     { current, generated, updateAvailable } doğru hesaplanır.
 * ──────────────────────────────────────────────────────────────────────── */

const PROJECT = "00000000-0000-4000-8000-000000000000";
const AUTH = { userId: "user_1", orgId: null, orgRole: null } as never;

function fakeGenerated(): GeneratedProject {
  return {
    target: "nestjs",
    files: [],
    nodeFiles: {},
    warnings: [],
    summary: {
      version: CODEGEN_VERSION,
      fileCount: 0,
      nodeCount: 0,
      surgicalMarkerCount: 0,
      skippedKinds: {},
    },
  };
}

function build(repoVersion: number | null | undefined, graphRev = 0, genGraphRev: number | null = null) {
  const service = { generate: vi.fn(async () => fakeGenerated()) };
  const billing = {
    assertCanGenerateOrFreePass: vi.fn(async () => {}),
    refund: vi.fn(async () => {}),
  };
  const projects = {
    setCodegenVersion: vi.fn(async () => {}),
    getCodegenVersion: vi.fn(async () => repoVersion),
    getGraphRevision: vi.fn(async () => graphRev),
    getCodegenGraphRevision: vi.fn(async () => genGraphRev),
  };
  const fill = { fill: vi.fn(async function* () {}) };
  const fills = { deleteOne: vi.fn(async () => {}) };
  const imports = { resolveImports: vi.fn(async (f: unknown) => f) };
  const controller = new CodegenController(service as never, billing as never, projects as never, fill as never, fills as never, imports as never);
  return { controller, service, billing, projects, fills, imports };
}

describe("CodegenController — sürüm damgalama (generate)", () => {
  it("başarılı generate -> projeye CODEGEN_VERSION damgalanır", async () => {
    const { controller, billing, service, projects } = build(undefined);
    await controller.generate(PROJECT, { target: "nestjs" } as never, AUTH);

    expect(billing.assertCanGenerateOrFreePass).toHaveBeenCalledWith("user_1");
    expect(service.generate).toHaveBeenCalledWith(PROJECT, "nestjs");
    expect(projects.setCodegenVersion).toHaveBeenCalledWith(PROJECT, CODEGEN_VERSION);
  });

  it("billing reddederse generate de damga da yapılmaz", async () => {
    const { controller, billing, service, projects } = build(undefined);
    billing.assertCanGenerateOrFreePass.mockRejectedValueOnce(new Error("ERR_PLAN_AI"));

    await expect(controller.generate(PROJECT, { target: "nestjs" } as never, AUTH)).rejects.toThrow();
    expect(service.generate).not.toHaveBeenCalled();
    expect(projects.setCodegenVersion).not.toHaveBeenCalled();
  });
});

describe("CodegenController — revert (bölgeyi stub'a geri al)", () => {
  it("deleteOne'ı projectId/nodeId/member ile çağırır + ok döner", async () => {
    const { controller, fills } = build(undefined);
    const res = await controller.revertFill(PROJECT, "node-1", "LoginAsync");
    expect(fills.deleteOne).toHaveBeenCalledWith(PROJECT, "node-1", "LoginAsync");
    expect(res.data).toEqual({ reverted: true });
  });
});

describe("CodegenController — status (updateAvailable mantığı)", () => {
  let CURRENT: number;
  beforeEach(() => {
    CURRENT = CODEGEN_VERSION;
  });

  it("hiç üretilmemiş (generated null) -> updateAvailable false + drift yok", async () => {
    const { controller } = build(null);
    const res = await controller.status(PROJECT);
    expect(res.data).toMatchObject({ current: CURRENT, generated: null, updateAvailable: false, diagramDrifted: false, driftCount: 0 });
  });

  it("damga eski (< current) -> updateAvailable true", async () => {
    const { controller } = build(CURRENT - 1);
    const res = await controller.status(PROJECT);
    expect(res.data).toMatchObject({ current: CURRENT, generated: CURRENT - 1, updateAvailable: true });
  });

  it("diyagram drift'i: graphRevision > generatedGraphRevision -> diagramDrifted + driftCount", async () => {
    // üretimde rev 3 damgalandı, şimdi rev 5 → 2 yapısal değişiklik (drift).
    const { controller } = build(CURRENT, 5, 3);
    const res = await controller.status(PROJECT);
    expect(res.data).toMatchObject({ diagramDrifted: true, driftCount: 2, graphRevision: 5, generatedGraphRevision: 3 });
  });

  it("drift yok: graphRevision == generatedGraphRevision", async () => {
    const { controller } = build(CURRENT, 4, 4);
    const res = await controller.status(PROJECT);
    expect(res.data).toMatchObject({ diagramDrifted: false, driftCount: 0 });
  });

  it("damga güncel (= current) -> updateAvailable false", async () => {
    const { controller } = build(CURRENT);
    const res = await controller.status(PROJECT);
    expect(res.data).toMatchObject({ current: CURRENT, generated: CURRENT, updateAvailable: false });
  });

  it("proje yok (getCodegenVersion undefined) -> 404 ERR_PROJECT_NOT_FOUND", async () => {
    const { controller } = build(undefined);
    await expect(controller.status(PROJECT)).rejects.toBeInstanceOf(NotFoundException);
  });
});
