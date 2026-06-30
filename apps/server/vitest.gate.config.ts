import { defineConfig } from "vitest/config";
import path from "node:path";

/* Whole-project tsc gate (codegen-tsc.gate.test.ts) — SEPARATE config.
* Slow + requires node_modules; By default it does not explore `*.spec.ts`.
* Run on CI with `pnpm test:codegen-gate`. */
export default defineConfig({
  test: {
    include: ["src/**/*.gate.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
//minimal defaults to prevent env.ts top-level parseEnv from exploding during import
// (same as default geart.config).
    env: {
      NEO4J_URI: "bolt://localhost:7687",
      NEO4J_USER: "neo4j",
      NEO4J_PASSWORD: "test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
