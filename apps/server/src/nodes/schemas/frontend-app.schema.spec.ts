import { describe, it, expect } from "vitest";
import { FrontendAppNodeSchema } from "./frontend-app.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  AppName: "AdminDashboard",
  Description: "Yönetim paneli",
  Framework: "React" as const,
  DeploymentType: "SPA" as const,
};

const parse = (properties: unknown) =>
  FrontendAppNodeSchema.parse({ ...validBase, type: "FrontendApp", properties });

describe("FrontendAppNodeSchema (enriched)", () => {
  it("geçerli FrontendApp'i parse eder (Routes default boş)", () => {
    const node = parse(validProperties);
    expect(node.properties.Framework).toBe("React");
    expect(node.properties.Routes).toEqual([]);
  });

  it("StateManagement + StylingApproach + Routes kabul eder", () => {
    const node = parse({
      ...validProperties,
      StateManagement: "Redux",
      StylingApproach: "Tailwind",
      Routes: [{ Path: "/users", ComponentRef: "UserDataTable" }],
    });
    expect(node.properties.StateManagement).toBe("Redux");
    expect(node.properties.Routes[0].ComponentRef).toBe("UserDataTable");
  });

  it("geçersiz StateManagement reddeder", () => {
    expect(() => parse({ ...validProperties, StateManagement: "MobX" })).toThrow();
  });

  it("Bilinmeyen Framework reddeder", () => {
    expect(() => parse({ ...validProperties, Framework: "Solid" })).toThrow();
  });

  it("Bilinmeyen DeploymentType reddeder", () => {
    expect(() => parse({ ...validProperties, DeploymentType: "PWA" })).toThrow();
  });
});
