import { describe, it, expect } from "vitest";
import { UIComponentNodeSchema } from "./ui-component.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  ComponentName: "UserDataTable",
  Description: "User table",
  Props: [{ Name: "users", Type: "User[]", Required: true }],
  State: [{ Name: "selectedId", Type: "string | null" }],
};

const parse = (properties: unknown) =>
  UIComponentNodeSchema.parse({ ...validBase, type: "UIComponent", properties });

describe("UIComponentNodeSchema (enriched)", () => {
  it("parses valid UIComponent", () => {
    const node = parse(validProperties);
    expect(node.properties.Props[0].Name).toBe("users");
    expect(node.properties.Props[0].Required).toBe(true);
  });

  it("Prop.Required default false", () => {
    const node = parse({ ...validProperties, Props: [{ Name: "title", Type: "string" }] });
    expect(node.properties.Props[0].Required).toBe(false);
  });

  it("accepts Events + ChildComponentRefs", () => {
    const node = parse({
      ...validProperties,
      Events: [{ Name: "onRowClick", PayloadType: "User" }],
      ChildComponentRefs: ["UserRow", "Pagination"],
    });
    expect(node.properties.Events[0].PayloadType).toBe("User");
    expect(node.properties.ChildComponentRefs).toEqual(["UserRow", "Pagination"]);
  });

  it("Props/State/Events/ChildComponentRefs default to empty array", () => {
    const node = parse({ ComponentName: "X", Description: "x" });
    expect(node.properties.Props).toEqual([]);
    expect(node.properties.Events).toEqual([]);
    expect(node.properties.ChildComponentRefs).toEqual([]);
  });

  it("Description is required", () => {
    const { Description, ...rest } = validProperties;
    expect(() => parse(rest)).toThrow();
  });
});
