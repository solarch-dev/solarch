import { describe, it, expect } from "vitest";
import { z, ZodError } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe";

const Schema = z.object({ name: z.string(), age: z.number() }).strict();

describe("ZodValidationPipe", () => {
  it("transforms valid body", () => {
    const pipe = new ZodValidationPipe(Schema);
    expect(pipe.transform({ name: "x", age: 1 })).toEqual({ name: "x", age: 1 });
  });

  it("throws ZodError on invalid body", () => {
    const pipe = new ZodValidationPipe(Schema);
    expect(() => pipe.transform({ name: "x" })).toThrow(ZodError);
  });

  it("throws ZodError on unknown field (strict)", () => {
    const pipe = new ZodValidationPipe(Schema);
    expect(() => pipe.transform({ name: "x", age: 1, extra: "y" })).toThrow(ZodError);
  });
});
