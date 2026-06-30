import { describe, it, expect } from "vitest";
import { countSurgicalMarkers, surgicalMarker, notImplemented } from "./surgical";

/* ────────────────────────────────────────────────────────────────────────
 * surgical.spec.ts — countSurgicalMarkers "DOLDURULACAK bölge" sayar:
 * marker − dolu damgası. Codegen tam ürettiği bölgeyi (queue producer) filled
 * damgaladığında "doldurulacak" sayılmamalı → UI toplamı = fill'in işlediği.
 * (Bug: "tuşa basınca 71 yerine 69 ile başlıyor" — codegen-dolu queue publish'ler.)
 * ──────────────────────────────────────────────────────────────────────── */

describe("countSurgicalMarkers — doldurulacak (pending) bölge sayısı", () => {
  it("NOT_IMPLEMENTED iskeletler sayılır (klasik fill noktaları)", () => {
    const body = [
      `  async createUser(): Promise<void> {`,
      `    ${surgicalMarker({ nodeId: "n1", member: "createUser" })}`,
      `    ${notImplemented("UsersService", "createUser")}`,
      `  }`,
    ].join("\n");
    expect(countSurgicalMarkers(body)).toBe(1);
  });

  it("codegen-dolu bölge (marker + @solarch:filled by=codegen) SAYILMAZ", () => {
    const body = [
      `  async publish(payload: JobDto): Promise<void> {`,
      `    ${surgicalMarker({ nodeId: "n2", member: "publish", deps: ["this.queue"] })}`,
      `    // @solarch:filled by=codegen`,
      `    await this.queue.add("publish", payload);`,
      `  }`,
    ].join("\n");
    expect(countSurgicalMarkers(body)).toBe(0);
  });

  it("karışık dosya: 2 iskelet + 1 codegen-dolu → 2 (doldurulacak)", () => {
    const skel = (m: string) =>
      [`  async ${m}(): Promise<void> {`, `    ${surgicalMarker({ nodeId: "n", member: m })}`, `    ${notImplemented("S", m)}`, `  }`].join("\n");
    const filled = [
      `  async publish(p: JobDto): Promise<void> {`,
      `    ${surgicalMarker({ nodeId: "q", member: "publish" })}`,
      `    // @solarch:filled by=codegen`,
      `    await this.queue.add("publish", p);`,
      `  }`,
    ].join("\n");
    const content = [skel("a"), skel("b"), filled].join("\n\n");
    expect(countSurgicalMarkers(content)).toBe(2);
  });

  it("marker yoksa 0", () => {
    expect(countSurgicalMarkers("export class X {}\n")).toBe(0);
  });
});
