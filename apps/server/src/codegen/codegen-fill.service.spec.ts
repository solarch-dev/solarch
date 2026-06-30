import { describe, it, expect, vi } from "vitest";
import { CodegenFillService, type FillEvent } from "./codegen-fill.service";

/* ────────────────────────────────────────────────────────────────────────
 * codegen-fill.service.spec.ts — persistRegion: DB bölgenin FINAL durumunu yansıtır.
 *
 * Bir bölge aynı akışta önce "filled" (ilk-dolum, import'lar çözülmeden → gerçek tip
 * hatası gizli) sonra "violation" (repair'de import'lar çözülünce hata görünür, model
 * çözemez) emit edebilir. persistRegion: filled → upsert, violation/error → deleteOne
 * (kırık gövde stub'a döner; stub DERLENİR). Aksi halde derlenmeyen gövde kalıcı olurdu.
 * ──────────────────────────────────────────────────────────────────────── */

const PROJECT = "00000000-0000-4000-8000-000000000000";

function build() {
  const fills = { upsert: vi.fn(async () => {}), deleteOne: vi.fn(async () => {}) };
  const codegen = {};
  const svc = new CodegenFillService(codegen as never, fills as never);
  // private metoda eriş (davranış kilidi).
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
  it("filled + body → upsert (gövde kalıcı yazılır)", async () => {
    const { fills, persist } = build();
    await persist(region({ status: "filled", body: "return dto;" }));
    expect(fills.upsert).toHaveBeenCalledWith(PROJECT, "node-1", "GetVideo", "return dto;", expect.any(String));
    expect(fills.deleteOne).not.toHaveBeenCalled();
  });

  it("violation → deleteOne (kırık gövde silinir → stub'a döner)", async () => {
    const { fills, persist } = build();
    await persist(region({ status: "violation", violations: ["type error (TS2322): ..."] }));
    expect(fills.deleteOne).toHaveBeenCalledWith(PROJECT, "node-1", "GetVideo");
    expect(fills.upsert).not.toHaveBeenCalled();
  });

  it("error → deleteOne (başarısız bölge stub kalır)", async () => {
    const { fills, persist } = build();
    await persist(region({ status: "error", error: "LLM failed" }));
    expect(fills.deleteOne).toHaveBeenCalledWith(PROJECT, "node-1", "GetVideo");
  });

  it("filled→violation SIRASI: önce yaz sonra sil → final stub (3-günlük GetVideo bug'ı)", async () => {
    const { fills, persist } = build();
    await persist(region({ status: "filled", body: "videoUrl: video.videoUrl" })); // ilk-dolum (gizli TS2322)
    await persist(region({ status: "violation" })); // repair çözemedi
    expect(fills.upsert).toHaveBeenCalledTimes(1);
    expect(fills.deleteOne).toHaveBeenCalledTimes(1); // net sonuç: bölge silindi (stub)
  });

  it("nodeId yoksa hiçbir şey yapmaz (kalıcılaştıracak hedef yok)", async () => {
    const { fills, persist } = build();
    await persist(region({ nodeId: undefined, status: "filled", body: "x" }));
    expect(fills.upsert).not.toHaveBeenCalled();
    expect(fills.deleteOne).not.toHaveBeenCalled();
  });

  it("filled ama body yok → yazmaz (boş gövde kalıcılaştırılmaz)", async () => {
    const { fills, persist } = build();
    await persist(region({ status: "filled", body: undefined }));
    expect(fills.upsert).not.toHaveBeenCalled();
  });
});
