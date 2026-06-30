import { describe, it, expect, vi } from "vitest";
import { CodegenFillService, type FillEvent } from "./codegen-fill.service";

/* ────────────────────────────────────────────────────────────────────────
 * codegen-fill.service.spec.ts — persistRegion: DB reflects region FINAL state.
 *
 * A region may emit "filled" first (initial fill, imports unresolved -> real type
 * error hidden) then "violation" (repair resolves imports -> error visible, model
 * cannot fix) in same flow. persistRegion: filled -> upsert, violation/error -> deleteOne
 * (broken body reverts to stub; stub COMPILES). Otherwise non-compiling body would persist.
 * ──────────────────────────────────────────────────────────────────────── */

const PROJECT = "00000000-0000-4000-8000-000000000000";

function build() {
  const fills = { upsert: vi.fn(async () => {}), deleteOne: vi.fn(async () => {}) };
  const codegen = {};
  const svc = new CodegenFillService(codegen as never, fills as never);
  // access private method (behavior lock).
  const persist = (ev: Extract<FillEvent, { event: "region" }>) =>
    (svc as unknown as { persistRegion(p: string, e: unknown): Promise<void> }).persistRegion(PROJECT, ev);
  return { fills, persist };
}

const region = (over: Partial<Extract<FillEvent, { event: "region" }>>): Extract<FillEvent, { event: "region" }> => ({
  event: "region",
  status: "filled",
  nodeId: "node-1",
  member: "GetVideo",
  file: "src/video/video.service.ts",
  attempts: 1,
  ...over,
});

describe("CodegenFillService.persistRegion", () => {
  it("filled + body -> upsert (body persisted)", async () => {
    const { fills, persist } = build();
    await persist(region({ status: "filled", body: "return dto;" }));
    expect(fills.upsert).toHaveBeenCalledWith(PROJECT, "node-1", "GetVideo", "return dto;", expect.any(String));
    expect(fills.deleteOne).not.toHaveBeenCalled();
  });

  it("violation -> deleteOne (broken body removed -> reverts to stub)", async () => {
    const { fills, persist } = build();
    await persist(region({ status: "violation", violations: ["type error (TS2322): ..."] }));
    expect(fills.deleteOne).toHaveBeenCalledWith(PROJECT, "node-1", "GetVideo");
    expect(fills.upsert).not.toHaveBeenCalled();
  });

  it("error -> deleteOne (failed region stays stub)", async () => {
    const { fills, persist } = build();
    await persist(region({ status: "error", error: "LLM failed" }));
    expect(fills.deleteOne).toHaveBeenCalledWith(PROJECT, "node-1", "GetVideo");
  });

  it("filled->violation ORDER: write then delete -> final stub (3-day GetVideo bug)", async () => {
    const { fills, persist } = build();
    await persist(region({ status: "filled", body: "videoUrl: video.videoUrl" })); // initial fill (hidden TS2322)
    await persist(region({ status: "violation" })); // repair could not fix
    expect(fills.upsert).toHaveBeenCalledTimes(1);
    expect(fills.deleteOne).toHaveBeenCalledTimes(1); // net result: region deleted (stub)
  });

  it("does nothing when nodeId missing (nothing to persist)", async () => {
    const { fills, persist } = build();
    await persist(region({ nodeId: undefined, status: "filled", body: "x" }));
    expect(fills.upsert).not.toHaveBeenCalled();
    expect(fills.deleteOne).not.toHaveBeenCalled();
  });

  it("filled but no body -> does not write (empty body not persisted)", async () => {
    const { fills, persist } = build();
    await persist(region({ status: "filled", body: undefined }));
    expect(fills.upsert).not.toHaveBeenCalled();
  });
});
