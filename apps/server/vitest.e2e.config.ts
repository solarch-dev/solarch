import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";
import path from "node:path";

export default defineConfig({
  plugins: [
//emitDecoratorMetadata required for NestJS DI to work — esbuild this
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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
