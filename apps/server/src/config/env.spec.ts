import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

const baseEnv = {
  NEO4J_URI: "bolt://localhost:7687",
  NEO4J_USER: "neo4j",
  NEO4J_PASSWORD: "x",
  LLM_GENERATION_PROVIDER: "openai",
  LLM_CHAT_PROVIDER: "openai",
} as const;

describe("parseEnv", () => {
  it("throws when NEO4J_URI is missing", () => {
    expect(() => parseEnv({ NEO4J_USER: "neo4j", NEO4J_PASSWORD: "x" })).toThrow();
  });

  it("parses valid env and fills defaults", () => {
    const env = parseEnv({ ...baseEnv });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.CORS_ORIGIN).toBe("http://localhost:3000");
    expect(parseEnv({ ...baseEnv }).CODEGEN_FILL_THROTTLE_LIMIT).toBe(10);
  });

  it("throws when LLM providers are missing", () => {
    expect(() =>
      parseEnv({ NEO4J_URI: "bolt://localhost:7687", NEO4J_USER: "neo4j", NEO4J_PASSWORD: "x" }),
    ).toThrow();
  });

  it("coerces PORT (string → number)", () => {
    const env = parseEnv({ ...baseEnv, PORT: "5000" });
    expect(env.PORT).toBe(5000);
  });

  it("fills embedding defaults (local, dim 384)", () => {
    const e = parseEnv({ ...baseEnv });
    expect(e.EMBED_PROVIDER).toBe("local");
    expect(e.EMBED_DIM).toBe(384);
    expect(e.EMBED_TOP_K).toBe(3);
  });

  it("rejects invalid NEO4J_URI", () => {
    expect(() => parseEnv({ ...baseEnv, NEO4J_URI: "not-a-url" })).toThrow();
  });
});
