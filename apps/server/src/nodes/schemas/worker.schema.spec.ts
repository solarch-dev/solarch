import { describe, it, expect } from "vitest";
import { WorkerNodeSchema } from "./worker.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  WorkerName: "DailyReportWorker",
  Description: "Günlük rapor oluşturur",
  Schedule: "0 0 * * *",
  TaskToExecute: "generateDailyReport",
  TimeoutSeconds: 300,
  RetryPolicy: { MaxRetries: 3, BackoffStrategy: "exponential" as const, DelaySeconds: 10 },
};

const parse = (properties: unknown) =>
  WorkerNodeSchema.parse({ ...validBase, type: "Worker", properties });

describe("WorkerNodeSchema (enriched)", () => {
  it("geçerli Worker'ı parse eder", () => {
    const node = parse(validProperties);
    expect(node.properties.RetryPolicy.MaxRetries).toBe(3);
    expect(node.properties.RetryPolicy.BackoffStrategy).toBe("exponential");
  });

  it("IsEnabled default true, Concurrency opsiyonel", () => {
    const node = parse(validProperties);
    expect(node.properties.IsEnabled).toBe(true);
    expect(node.properties.Concurrency).toBeUndefined();
  });

  it("RetryPolicy object olmalı (eski number reddedilir)", () => {
    expect(() => parse({ ...validProperties, RetryPolicy: 3 })).toThrow();
  });

  it("geçersiz BackoffStrategy reddeder", () => {
    expect(() => parse({ ...validProperties, RetryPolicy: { MaxRetries: 1, BackoffStrategy: "linear" } })).toThrow();
  });

  it("MaxRetries negatif olamaz", () => {
    expect(() => parse({ ...validProperties, RetryPolicy: { MaxRetries: -1 } })).toThrow();
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("TimeoutSeconds pozitif olmalı", () => {
    expect(() => parse({ ...validProperties, TimeoutSeconds: 0 })).toThrow();
  });
});
