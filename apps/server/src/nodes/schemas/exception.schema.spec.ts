import { describe, it, expect } from "vitest";
import { ExceptionNodeSchema } from "./exception.schema";

const validBase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  position: { x: 0, y: 0 },
  createdAt: "2026-05-21T10:30:00.000Z",
  updatedAt: "2026-05-21T10:30:00.000Z",
};

const validProperties = {
  ExceptionName: "InvalidPasswordException",
  Description: "Password rule violation",
  HttpStatusCode: 400,
  LogSeverity: "Warning" as const,
};

const parse = (properties: unknown) =>
  ExceptionNodeSchema.parse({ ...validBase, type: "Exception", properties });

describe("ExceptionNodeSchema (enriched)", () => {
  it("parses valid Exception", () => {
    expect(parse(validProperties).properties.HttpStatusCode).toBe(400);
  });

  it("accepts ErrorCode + ParentExceptionRef", () => {
    const node = parse({ ...validProperties, ErrorCode: "ERR_INVALID_PASSWORD", ParentExceptionRef: "ValidationException" });
    expect(node.properties.ErrorCode).toBe("ERR_INVALID_PASSWORD");
    expect(node.properties.ParentExceptionRef).toBe("ValidationException");
  });

  it("rejects HttpStatusCode outside 100-599 range", () => {
    expect(() => parse({ ...validProperties, HttpStatusCode: 600 })).toThrow();
  });

  it("rejects unknown LogSeverity", () => {
    expect(() => parse({ ...validProperties, LogSeverity: "Trace" })).toThrow();
  });
});
