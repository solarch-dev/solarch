import { describe, it, expect } from "vitest";
import { NodeSchema, KIND_LABELS, type NodeKind } from "./index";

const baseFields = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

describe("NodeSchema (union)", () => {
  it("Table tipini parse eder", () => {
    const node = NodeSchema.parse({
      ...baseFields, type: "Table",
      properties: {
        TableName: "u", Description: "d",
        Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }],
      },
    });
    expect(node.type).toBe("Table");
  });

  it("Bilinmeyen type'ı reddeder", () => {
    expect(() => NodeSchema.parse({ ...baseFields, type: "Foo", properties: {} })).toThrow();
  });

  it("KIND_LABELS 5 tipi içerir", () => {
    const labels: NodeKind[] = ["Table", "DTO", "Model", "Enum", "View"];
    for (const k of labels) {
      expect(KIND_LABELS[k]).toBe(k);
    }
  });
});
