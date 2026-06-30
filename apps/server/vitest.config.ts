import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "node",
    globals: false,
    testTimeout: 10000,
    // env.ts top-level `parseEnv(process.env)` çalıştırır; unit testlerde gerçek
    // .env yok. Minimal default'lar ver ki modül import'u patlamasın (e2e script'i
    // zaten aynısını npm env'leriyle yapıyor). parseEnv testleri explicit obje
    // geçtiği için bundan etkilenmez.
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
