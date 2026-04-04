import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier/flat";
import nodePlugin from "eslint-plugin-n";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["eslint.config.mjs"] },
  js.configs.recommended,
  prettier,
  ...nodePlugin.configs["flat/mixed-esm-and-cjs"],
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      "no-console": "warn",
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "commonjs" },
  },
]);
