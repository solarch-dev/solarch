import { describe, it, expect } from "vitest";
import { EventHandlerNodeSchema } from "./event-handler.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  HandlerName: "UserCreatedEmailHandler",
  Description: "Yeni kullanıcıya hoşgeldin maili",
  EventName: "USER_CREATED",
  IsAsync: true,
};

const parse = (properties: unknown) =>
  EventHandlerNodeSchema.parse({ ...validBase, type: "EventHandler", properties });

describe("EventHandlerNodeSchema (enriched)", () => {
  it("geçerli EventHandler'ı parse eder (opsiyoneller boş)", () => {
    const node = parse(validProperties);
    expect(node.properties.EventName).toBe("USER_CREATED");
    expect(node.properties.QueueRef).toBeUndefined();
  });

  it("QueueRef + RetryPolicy + DeadLetterQueue kabul eder", () => {
    const node = parse({
      ...validProperties,
      QueueRef: "user-events",
      RetryPolicy: { MaxRetries: 5, DelaySeconds: 30 },
      DeadLetterQueue: "user-events-dlq",
    });
    expect(node.properties.QueueRef).toBe("user-events");
    expect(node.properties.RetryPolicy?.MaxRetries).toBe(5);
  });

  it("RetryPolicy.MaxRetries negatif olamaz", () => {
    expect(() => parse({ ...validProperties, RetryPolicy: { MaxRetries: -1 } })).toThrow();
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("IsAsync boolean değilse fırlatır", () => {
    expect(() => parse({ ...validProperties, IsAsync: "yes" })).toThrow();
  });
});
