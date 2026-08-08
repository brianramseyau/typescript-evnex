// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts", "examples/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // Wave 0/1 leaves many contract stubs whose bodies are just
      // `throw new Error("TODO(...)")`, so their declared parameters are
      // unused until the owning agent implements them (PLAN.md §4.3). Only
      // flag genuinely unused local variables, not stub parameters.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
