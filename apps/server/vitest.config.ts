import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "node",
    globals: false,
    testTimeout: 10000,
    // env.ts runs top-level `parseEnv(process.env)`; unit tests have no real
    // .env file. Provide minimal defaults so module import does not crash (e2e script
    // already does the same via npm env vars). parseEnv tests pass explicit object
    // so they are unaffected by this.
    env: {
      NEO4J_URI: "bolt://localhost:7687",
      NEO4J_USER: "neo4j",
      NEO4J_PASSWORD: "test",
      LLM_GENERATION_PROVIDER: "openai",
      LLM_CHAT_PROVIDER: "openai",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
