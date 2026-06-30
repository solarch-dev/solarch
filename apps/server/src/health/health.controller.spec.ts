import { describe, it, expect } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller";

const make = (ping: () => Promise<void>) => new HealthController({ ping } as never);

describe("HealthController", () => {
  it("liveness: returns status ok (does not touch DB)", () => {
    const controller = make(async () => {});
    const result = controller.check();
    expect(result.success).toBe(true);
    expect(result.data.status).toBe("ok");
    expect(typeof result.data.uptime).toBe("number");
  });

  it("readiness: DB up → status ready (200)", async () => {
    const controller = make(async () => {});
    const result = await controller.ready();
    expect(result.success).toBe(true);
    expect(result.data.status).toBe("ready");
  });

  it("readiness: DB down → ServiceUnavailableException (503) ERR_NOT_READY", async () => {
    const controller = make(async () => { throw new Error("neo4j down"); });
    let caught: ServiceUnavailableException | null = null;
    try { await controller.ready(); } catch (e) { caught = e as ServiceUnavailableException; }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect((caught!.getResponse() as { code: string }).code).toBe("ERR_NOT_READY");
  });
});
