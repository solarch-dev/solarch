import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { assertNoPlaintextSecret, redactNodeSecrets } from "./secret-redaction";

describe("secret-redaction", () => {
  describe("assertNoPlaintextSecret (yazım)", () => {
    it("secret + düz-metin DefaultValue reddedilir (ERR_SECRET_PLAINTEXT)", () => {
      let caught: BadRequestException | null = null;
      try {
        assertNoPlaintextSecret("EnvironmentVariable", {
          Key: "AWS_SECRET",
          IsSecret: true,
          DefaultValue: "AKIA-cok-gizli",
        });
      } catch (e) {
        caught = e as BadRequestException;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught!.getResponse() as { code: string }).code).toBe("ERR_SECRET_PLAINTEXT");
    });

    it("secret ama DefaultValue boş/yoksa geçer", () => {
      expect(() => assertNoPlaintextSecret("EnvironmentVariable", { IsSecret: true, DefaultValue: "" })).not.toThrow();
      expect(() => assertNoPlaintextSecret("EnvironmentVariable", { IsSecret: true })).not.toThrow();
      expect(() => assertNoPlaintextSecret("EnvironmentVariable", { IsSecret: true, DefaultValue: "   " })).not.toThrow();
    });

    it("secret değilse DefaultValue serbest", () => {
      expect(() => assertNoPlaintextSecret("EnvironmentVariable", { IsSecret: false, DefaultValue: "3000" })).not.toThrow();
    });

    it("EnvironmentVariable dışındaki tipler kapsam dışı", () => {
      expect(() => assertNoPlaintextSecret("Service", { IsSecret: true, DefaultValue: "x" })).not.toThrow();
    });
  });

  describe("redactNodeSecrets (okuma)", () => {
    it("secret DefaultValue okumada boşlanır, girdi mutate edilmez", () => {
      const props = { Key: "AWS_SECRET", IsSecret: true, DefaultValue: "AKIA-cok-gizli" };
      const out = redactNodeSecrets("EnvironmentVariable", props);
      expect(out.DefaultValue).toBe("");
      expect(props.DefaultValue).toBe("AKIA-cok-gizli"); // orijinal değişmedi
    });

    it("secret olmayan/diğer tipler aynen döner", () => {
      const a = { IsSecret: false, DefaultValue: "3000" };
      expect(redactNodeSecrets("EnvironmentVariable", a)).toBe(a);
      const b = { Foo: "bar" };
      expect(redactNodeSecrets("Service", b)).toBe(b);
    });
  });
});
