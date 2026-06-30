import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { validateNodeProperties } from "./validate-properties";

describe("validateNodeProperties", () => {
  it("parses valid properties and applies defaults", () => {
    const out = validateNodeProperties("EnvironmentVariable", {
      Key: "PORT",
      Description: "application port",
      DataType: "Number",
      IsSecret: false,
      Environment: ["Dev"],
    });
    expect(out.Key).toBe("PORT");
    expect(out.IsRequired).toBe(true); // schema default
  });

  it("invalid properties → ERR_SCHEMA_INVALID + field details", () => {
    let caught: BadRequestException | null = null;
    try {
      validateNodeProperties("EnvironmentVariable", { Description: "missing Key", DataType: "Number" });
    } catch (e) {
      caught = e as BadRequestException;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const body = caught!.getResponse() as { code: string; details: Array<{ field: string }> };
    expect(body.code).toBe("ERR_SCHEMA_INVALID");
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it("rejects extra fields (strict)", () => {
    expect(() =>
      validateNodeProperties("EnvironmentVariable", {
        Key: "X",
        Description: "x",
        DataType: "String",
        IsSecret: false,
        Environment: ["Dev"],
        Unexpected: "field",
      }),
    ).toThrow(BadRequestException);
  });

  it("unknown kind → ERR_UNKNOWN_KIND", () => {
    let caught: BadRequestException | null = null;
    try {
      validateNodeProperties("Nope", {});
    } catch (e) {
      caught = e as BadRequestException;
    }
    expect((caught!.getResponse() as { code: string }).code).toBe("ERR_UNKNOWN_KIND");
  });
});
