import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Flat config (ESLint 9). Syntactic recommended + TS recommended; type-aware (parserOptions.
// project) KAPALI → hızlı + mevcut kodu patlatmadan yeşil gate. Sertleşmesi sonra.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // `const self = this` SSE/async-generator closure'larında bilinçli (arrow generator olamaz).
      "@typescript-eslint/no-this-alias": "warn",
    },
  },
);
