import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { assertNoPlaintextSecret, redactNodeSecrets } from "./secret-redaction";

describe("secret-redaction", () => {
  describe("assertNoPlaintextSecret (write)", () => {
    it("rejects secret + plain-text DefaultValue (ERR_SECRET_PLAINTEXT)", () => {
      let caught: BadRequestException | null = null;
      try {
        assertNoPlaintextSecret("EnvironmentVariable", {
          Key: "AWS_SECRET",
          IsSecret: true,
          DefaultValue: "AKIA-very-secret",
        });
      } catch (e) {
        caught = e as BadRequestException;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught!.getResponse() as { code: string }).code).toBe("ERR_SECRET_PLAINTEXT");
    });

    it("passes when secret but DefaultValue empty/missing", () => {
      expect(() => assertNoPlaintextSecret("EnvironmentVariable", { IsSecret: true, DefaultValue: "" })).not.toThrow();
      expect(() => assertNoPlaintextSecret("EnvironmentVariable", { IsSecret: true })).not.toThrow();
      expect(() => assertNoPlaintextSecret("EnvironmentVariable", { IsSecret: true, DefaultValue: "   " })).not.toThrow();
    });

    it("allows DefaultValue when not secret", () => {
      expect(() => assertNoPlaintextSecret("EnvironmentVariable", { IsSecret: false, DefaultValue: "3000" })).not.toThrow();
    });

    it("out of scope for non-EnvironmentVariable types", () => {
      expect(() => assertNoPlaintextSecret("Service", { IsSecret: true, DefaultValue: "x" })).not.toThrow();
    });
  });

  describe("redactNodeSecrets (read)", () => {
    it("clears secret DefaultValue on read without mutating input", () => {
      const props = { Key: "AWS_SECRET", IsSecret: true, DefaultValue: "AKIA-very-secret" };
      const out = redactNodeSecrets("EnvironmentVariable", props);
      expect(out.DefaultValue).toBe("");
      expect(props.DefaultValue).toBe("AKIA-very-secret"); // original unchanged
    });

    it("returns non-secret/other types unchanged", () => {
      const a = { IsSecret: false, DefaultValue: "3000" };
      expect(redactNodeSecrets("EnvironmentVariable", a)).toBe(a);
      const b = { Foo: "bar" };
      expect(redactNodeSecrets("Service", b)).toBe(b);
    });
  });
});
