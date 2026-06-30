import { describe, it, expect } from "vitest";
import { MessageQueueNodeSchema } from "./message-queue.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  QueueName: "order-events",
  Description: "Sipariş olayları",
  Type: "Topic" as const,
  Provider: "Kafka" as const,
  MessageFormat: "OrderEventDTO",
};

const parse = (properties: unknown) =>
  MessageQueueNodeSchema.parse({ ...validBase, type: "MessageQueue", properties });

describe("MessageQueueNodeSchema (enriched)", () => {
  it("geçerli MessageQueue'yu parse eder", () => {
    const node = parse(validProperties);
    expect(node.properties.Provider).toBe("Kafka");
  });

  it("teslim garantisi + DLQ + retention kabul eder", () => {
    const node = parse({
      ...validProperties,
      DeliveryGuarantee: "exactly-once",
      MaxRetries: 3,
      DeadLetterQueue: "order-events-dlq",
      RetentionSeconds: 604800,
    });
    expect(node.properties.DeliveryGuarantee).toBe("exactly-once");
    expect(node.properties.RetentionSeconds).toBe(604800);
  });

  it("geçersiz DeliveryGuarantee reddeder", () => {
    expect(() => parse({ ...validProperties, DeliveryGuarantee: "best-effort" })).toThrow();
  });

  it("Bilinmeyen Provider reddeder", () => {
    expect(() => parse({ ...validProperties, Provider: "Redis" })).toThrow();
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });
});
