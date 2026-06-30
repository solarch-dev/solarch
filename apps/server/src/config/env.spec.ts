import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("eksik NEO4J_URI'de fırlatır", () => {
    expect(() => parseEnv({ NEO4J_USER: "neo4j", NEO4J_PASSWORD: "x" })).toThrow();
  });

  it("geçerli env'i parse eder ve default'ları doldurur", () => {
    const env = parseEnv({
      NEO4J_URI: "bolt://localhost:7687",
      NEO4J_USER: "neo4j",
      NEO4J_PASSWORD: "x",
    });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.CORS_ORIGIN).toBe("http://localhost:3000");
  });

  it("PORT'u coerce eder (string → number)", () => {
    const env = parseEnv({
      NEO4J_URI: "bolt://localhost:7687",
      NEO4J_USER: "neo4j",
      NEO4J_PASSWORD: "x",
      PORT: "5000",
    });
    expect(env.PORT).toBe(5000);
  });

  it("embedding default'larını doldurur (local, dim 384)", () => {
    const e = parseEnv({ NEO4J_URI: "bolt://localhost:7687", NEO4J_USER: "neo4j", NEO4J_PASSWORD: "x" });
    expect(e.EMBED_PROVIDER).toBe("local");
    expect(e.EMBED_DIM).toBe(384);
    expect(e.EMBED_TOP_K).toBe(3);
  });

  it("geçersiz NEO4J_URI'yi reddeder", () => {
    expect(() => parseEnv({
      NEO4J_URI: "not-a-url",
      NEO4J_USER: "neo4j",
      NEO4J_PASSWORD: "x",
    })).toThrow();
  });
});
