import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

// IP-0_DESIGN §8 (boundaries), §14 (no any), §23 (zero errors), §27 (no console).
// dependency-cruiser is the CI gate for boundaries; these rules are editor feedback.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/drizzle/meta/**",
      "**/next-env.d.ts",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "process.env is read only inside env.ts (IP-0_DESIGN §11).",
        },
      ],
    },
  },
  {
    // env.ts is the single sanctioned process.env boundary (§11).
    files: ["**/env.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // packages/core purity: no ambient clock, no IO, no environment (§8).
    files: ["packages/core/src/**"],
    rules: {
      "no-restricted-globals": ["error", "process", "fetch"],
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message: "core receives time via an injected Clock (IP-0_DESIGN §8).",
        },
      ],
    },
  },
  {
    // Loggers, repo scripts and throwaway spikes may write to stdout.
    files: ["**/logger.ts", "scripts/**", "spikes/**"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Config files at package roots are not part of a TS project.
    files: ["**/*.mjs", "**/*.cjs", "**/*.config.ts", "**/drizzle.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
