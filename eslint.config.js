import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default defineConfig(
  { ignores: ["dist", "coverage", "node_modules"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  {
    // Plain JS/MJS files sit outside the TypeScript program.
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Repository scripts run under Node and use its built-in web APIs.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        AbortController: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        WebSocket: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  prettier,
);
