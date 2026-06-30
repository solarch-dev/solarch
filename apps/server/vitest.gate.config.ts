import { defineConfig } from "vitest/config";
import path from "node:path";

/* Bütün-proje tsc geçidi (codegen-tsc.gate.test.ts) — AYRI config.
 * Yavaş + node_modules gerektirir; default `*.spec.ts` keşfine girmez.
 * `pnpm test:codegen-gate` ile / CI'da koşulur. */
export default defineConfig({
  test: {
    include: ["src/**/*.gate.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // env.ts top-level parseEnv'i import sırasında patlamasın diye minimal default'lar
    // (default vitest.config ile aynı).
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
