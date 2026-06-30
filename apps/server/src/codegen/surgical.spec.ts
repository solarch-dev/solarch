import { describe, it, expect } from "vitest";
import { countSurgicalMarkers, surgicalMarker, notImplemented } from "./surgical";

/* ────────────────────────────────────────────────────────────────────────
 * surgical.spec.ts — countSurgicalMarkers counts "TO-FILL" regions:
 * markers minus filled stamps. When codegen fully produces a region (queue producer)
 * and stamps `@solarch:filled by=codegen`, it must NOT count as "to fill" -> UI total
 * matches what fill processes.
 * (Bug: "starts with 69 instead of 71 on button press" — codegen-filled queue publishes.)
 * ──────────────────────────────────────────────────────────────────────── */

describe("countSurgicalMarkers — pending (to-fill) region count", () => {
  it("NOT_IMPLEMENTED skeletons are counted (classic fill points)", () => {
    const body = [
      `  async createUser(): Promise<void> {`,
      `    ${surgicalMarker({ nodeId: "n1", member: "createUser" })}`,
      `    ${notImplemented("UsersService", "createUser")}`,
      `  }`,
    ].join("\n");
    expect(countSurgicalMarkers(body)).toBe(1);
  });

  it("codegen-filled region (marker + @solarch:filled by=codegen) is NOT counted", () => {
    const body = [
      `  async publish(payload: JobDto): Promise<void> {`,
      `    ${surgicalMarker({ nodeId: "n2", member: "publish", deps: ["this.queue"] })}`,
      `    // @solarch:filled by=codegen`,
      `    await this.queue.add("publish", payload);`,
      `  }`,
    ].join("\n");
    expect(countSurgicalMarkers(body)).toBe(0);
  });

  it("mixed file: 2 skeletons + 1 codegen-filled -> 2 (to fill)", () => {
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

  it("returns 0 when no markers", () => {
    expect(countSurgicalMarkers("export class X {}\n")).toBe(0);
  });
});
