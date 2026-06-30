import { describe, it, expect, vi } from "vitest";
import { TabsController } from "./tabs.controller";

describe("TabsController", () => {
  const service = { create: vi.fn().mockResolvedValue({ id: "t" }), addReference: vi.fn(), saveLayout: vi.fn() };
  const c = new TabsController(service as any);

  it("create envelope döner", async () => {
    expect(await c.create("p", { name: "X" } as any)).toEqual({ success: true, data: { id: "t" } });
  });
  it("addReference x/y geçirir + envelope", async () => {
    const r = await c.addReference("p", "t", "n", { x: 3, y: 4 } as any);
    expect(service.addReference).toHaveBeenCalledWith("p", "t", "n", 3, 4);
    expect(r).toEqual({ success: true, data: { tabId: "t", nodeId: "n", x: 3, y: 4 } });
  });
});
