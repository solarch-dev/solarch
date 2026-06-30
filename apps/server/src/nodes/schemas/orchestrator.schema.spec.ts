import { describe, it, expect } from "vitest";
import { OrchestratorNodeSchema } from "./orchestrator.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-22T10:30:00.000Z",
  updatedAt: "2026-05-22T10:30:00.000Z",
};

const validProperties = {
  OrchestratorName: "OrderSaga",
  Description: "Sipariş Saga koordinasyonu",
  Pattern: "Saga" as const,
};

const parse = (properties: unknown) =>
  OrchestratorNodeSchema.parse({ ...validBase, type: "Orchestrator", properties });

describe("OrchestratorNodeSchema (enriched)", () => {
  it("geçerli Orchestrator'ı parse eder (Steps default boş)", () => {
    const node = parse(validProperties);
    expect(node.properties.Pattern).toBe("Saga");
    expect(node.properties.Steps).toEqual([]);
  });

  it("Steps (ServiceRef + CompensationAction + OnFailure) kabul eder", () => {
    const node = parse({
      ...validProperties,
      Steps: [
        { StepName: "reserveStock", ServiceRef: "InventoryService", Action: "reserve", CompensationAction: "release", OnFailure: "compensate" },
        { StepName: "charge", ServiceRef: "PaymentService", Action: "charge" },
      ],
    });
    expect(node.properties.Steps).toHaveLength(2);
    expect(node.properties.Steps[0].OnFailure).toBe("compensate");
    expect(node.properties.Steps[1].OnFailure).toBe("abort"); // default
  });

  it("geçersiz OnFailure reddeder", () => {
    expect(() => parse({
      ...validProperties,
      Steps: [{ StepName: "x", ServiceRef: "S", Action: "a", OnFailure: "ignore" }],
    })).toThrow();
  });

  it("Description zorunlu", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });

  it("Bilinmeyen Pattern reddeder", () => {
    expect(() => parse({ ...validProperties, Pattern: "Choreography" })).toThrow();
  });
});
