import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Flat config (ESLint 9). Syntactic recommended + TS recommended; type-aware (parserOptions.
//project) OFF → fast + green gate without blowing up existing code. After hardening.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
// `const self = this` is intentional in SSE/async-generator closures (cannot be an arrow generator).
      "@typescript-eslint/no-this-alias": "warn",
    },
  },
);
