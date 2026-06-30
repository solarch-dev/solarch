import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { CodegenController } from "./codegen.controller";
import { CODEGEN_VERSION } from "./codegen.version";
import type { GeneratedProject } from "./types";

/* ────────────────────────────────────────────────────────────────────────
 * codegen.controller.spec.ts — version stamping + status unit tests.
 *
 *   - successful generate -> service.generate +
 *     projects.setCodegenVersion(projectId, CODEGEN_VERSION) IS CALLED (stamp).
 *   - status: for generated null / stale / current / missing project combinations
 *     { current, generated, updateAvailable } is computed correctly.
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
  const projects = {
    setCodegenVersion: vi.fn(async () => {}),
    getCodegenVersion: vi.fn(async () => repoVersion),
    getGraphRevision: vi.fn(async () => graphRev),
    getCodegenGraphRevision: vi.fn(async () => genGraphRev),
  };
  const fill = { fill: vi.fn(async function* () {}) };
  const fills = { deleteOne: vi.fn(async () => {}) };
  const imports = { resolveImports: vi.fn(async (f: unknown) => f) };
  const controller = new CodegenController(service as never, projects as never, fill as never, fills as never, imports as never);
  return { controller, service, projects, fills, imports };
}

describe("CodegenController — version stamping (generate)", () => {
  it("successful generate -> stamps CODEGEN_VERSION on project", async () => {
    const { controller, service, projects } = build(undefined);
    await controller.generate(PROJECT, { target: "nestjs" } as never, AUTH);

    expect(service.generate).toHaveBeenCalledWith(PROJECT, "nestjs");
    expect(projects.setCodegenVersion).toHaveBeenCalledWith(PROJECT, CODEGEN_VERSION);
  });

  it("when generate fails, stamp does not run", async () => {
    const { controller, service, projects } = build(undefined);
    service.generate.mockRejectedValueOnce(new Error("ERR_PROJECT_NOT_FOUND"));

    await expect(controller.generate(PROJECT, { target: "nestjs" } as never, AUTH)).rejects.toThrow();
    expect(projects.setCodegenVersion).not.toHaveBeenCalled();
  });
});

describe("CodegenController — revert (restore region to stub)", () => {
  it("calls deleteOne with projectId/nodeId/member + returns ok", async () => {
    const { controller, fills } = build(undefined);
    const res = await controller.revertFill(PROJECT, "node-1", "LoginAsync");
    expect(fills.deleteOne).toHaveBeenCalledWith(PROJECT, "node-1", "LoginAsync");
    expect(res.data).toEqual({ reverted: true });
  });
});

describe("CodegenController — status (updateAvailable logic)", () => {
  let CURRENT: number;
  beforeEach(() => {
    CURRENT = CODEGEN_VERSION;
  });

  it("never generated (generated null) -> updateAvailable false + no drift", async () => {
    const { controller } = build(null);
    const res = await controller.status(PROJECT);
    expect(res.data).toMatchObject({ current: CURRENT, generated: null, updateAvailable: false, diagramDrifted: false, driftCount: 0 });
  });

  it("stale stamp (< current) -> updateAvailable true", async () => {
    const { controller } = build(CURRENT - 1);
    const res = await controller.status(PROJECT);
    expect(res.data).toMatchObject({ current: CURRENT, generated: CURRENT - 1, updateAvailable: true });
  });

  it("diagram drift: graphRevision > generatedGraphRevision -> diagramDrifted + driftCount", async () => {
    // rev 3 stamped at generation, now rev 5 → 2 structural changes (drift).
    const { controller } = build(CURRENT, 5, 3);
    const res = await controller.status(PROJECT);
    expect(res.data).toMatchObject({ diagramDrifted: true, driftCount: 2, graphRevision: 5, generatedGraphRevision: 3 });
  });

  it("no drift: graphRevision == generatedGraphRevision", async () => {
    const { controller } = build(CURRENT, 4, 4);
    const res = await controller.status(PROJECT);
    expect(res.data).toMatchObject({ diagramDrifted: false, driftCount: 0 });
  });

  it("current stamp (= current) -> updateAvailable false", async () => {
    const { controller } = build(CURRENT);
    const res = await controller.status(PROJECT);
    expect(res.data).toMatchObject({ current: CURRENT, generated: CURRENT, updateAvailable: false });
  });

  it("missing project (getCodegenVersion undefined) -> 404 ERR_PROJECT_NOT_FOUND", async () => {
    const { controller } = build(undefined);
    await expect(controller.status(PROJECT)).rejects.toBeInstanceOf(NotFoundException);
  });
});
