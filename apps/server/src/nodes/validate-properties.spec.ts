import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { validateNodeProperties } from "./validate-properties";

describe("validateNodeProperties", () => {
  it("geçerli properties parse edilir + default'lar uygulanır", () => {
    const out = validateNodeProperties("EnvironmentVariable", {
      Key: "PORT",
      Description: "uygulama portu",
      DataType: "Number",
      IsSecret: false,
      Environment: ["Dev"],
    });
    expect(out.Key).toBe("PORT");
    expect(out.IsRequired).toBe(true); // şema default'u
  });

  it("geçersiz properties → ERR_SCHEMA_INVALID + alan detayı", () => {
    let caught: BadRequestException | null = null;
    try {
      validateNodeProperties("EnvironmentVariable", { Description: "eksik Key", DataType: "Number" });
    } catch (e) {
      caught = e as BadRequestException;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const body = caught!.getResponse() as { code: string; details: Array<{ field: string }> };
    expect(body.code).toBe("ERR_SCHEMA_INVALID");
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it("fazla alan reddedilir (strict)", () => {
    expect(() =>
      validateNodeProperties("EnvironmentVariable", {
        Key: "X",
        Description: "x",
        DataType: "String",
        IsSecret: false,
        Environment: ["Dev"],
        Beklenmeyen: "alan",
      }),
    ).toThrow(BadRequestException);
  });

  it("bilinmeyen kind → ERR_UNKNOWN_KIND", () => {
    let caught: BadRequestException | null = null;
    try {
      validateNodeProperties("Nope", {});
    } catch (e) {
      caught = e as BadRequestException;
    }
    expect((caught!.getResponse() as { code: string }).code).toBe("ERR_UNKNOWN_KIND");
  });
});
