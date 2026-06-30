import { describe, it, expect, vi } from "vitest";
import { NodesController } from "./nodes.controller";
import { NodesService } from "./nodes.service";

const projectId = "550e8400-e29b-41d4-a716-446655440001";
const validTablePayload = {
  type: "Table",
  projectId,
  position: { x: 0, y: 0 },
  properties: {
    TableName: "users",
    Description: "u",
    Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }],
  },
};

describe("NodesController.create", () => {
  it("service.create'i URL projectId ile çağırır ve envelope döner", async () => {
    const service = { create: vi.fn(async (_p, input) => ({ ...input, id: "x", createdAt: "t", updatedAt: "t" })) };
    const controller = new NodesController(service as unknown as NodesService);
    const result = await controller.create(projectId, validTablePayload as any);
    expect(service.create).toHaveBeenCalledWith(projectId, validTablePayload);
    expect(result.success).toBe(true);
    expect(result.data.id).toBe("x");
  });
});

describe("NodesController.getById", () => {
  it("service.getById'i çağırır ve envelope döner", async () => {
    const service = { getById: vi.fn(async () => ({ id: "x", type: "Table" })) };
    const controller = new NodesController(service as unknown as NodesService);
    const result = await controller.getById("p", "x");
    expect(service.getById).toHaveBeenCalledWith("p", "x");
    expect(result.success).toBe(true);
  });
});

describe("NodesController.list", () => {
  it("type filter ile çağırır", async () => {
    const service = { list: vi.fn(async () => [{ id: "x", type: "Table" }]) };
    const controller = new NodesController(service as unknown as NodesService);
    const result = await controller.list("p", "Table");
    expect(service.list).toHaveBeenCalledWith("p", "Table");
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
  });

  it("type filter olmadan çağırır", async () => {
    const service = { list: vi.fn(async () => []) };
    const controller = new NodesController(service as unknown as NodesService);
    const result = await controller.list("p", undefined);
    expect(service.list).toHaveBeenCalledWith("p", undefined);
    expect(result.data.total).toBe(0);
  });
});

describe("NodesController.update", () => {
  it("position update", async () => {
    const service = { update: vi.fn(async () => ({ id: "x", type: "Table" })) };
    const controller = new NodesController(service as unknown as NodesService);
    const result = await controller.update("p", "x", { position: { x: 1, y: 2 } } as any);
    expect(service.update).toHaveBeenCalledWith("p", "x", { position: { x: 1, y: 2 } });
    expect(result.success).toBe(true);
  });
});

describe("NodesController.delete", () => {
  it("service.delete'i çağırır", async () => {
    const service = { delete: vi.fn(async () => undefined) };
    const controller = new NodesController(service as unknown as NodesService);
    await controller.delete("p", "x");
    expect(service.delete).toHaveBeenCalledWith("p", "x");
  });
});
