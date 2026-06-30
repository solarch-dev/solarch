import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";
import path from "node:path";

export default defineConfig({
  plugins: [
    // NestJS DI'nin çalışması için emitDecoratorMetadata gerekli — esbuild bunu
    // desteklemiyor, SWC transformer ile decorator metadata korunur.
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
      },
    }),
  ],
  test: {
    include: ["test/**/*.e2e-spec.ts"],
    environment: "node",
    globals: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // billing e2e için sahte Polar env (env.ts import-anında okur)
    env: {
      POLAR_WEBHOOK_SECRET: "whsec_test",
      POLAR_ACCESS_TOKEN: "polar_test",
      POLAR_SERVER: "sandbox",
      POLAR_PRODUCT_DRAW: "prod_draw",
      POLAR_PRODUCT_BUILD: "prod_build",
      POLAR_PRODUCT_CODE: "prod_code",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
