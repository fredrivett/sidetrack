import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Agent anti-pattern rules. Agents reach for `any` and stub throws when the
  // type or implementation is hard; block them at the linter so they show up
  // in the same turn the agent wrote them, not in review.
  {
    files: ["src/**/*.{ts,tsx,mts}", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ThrowStatement > NewExpression[callee.name='Error'][arguments.0.value=/not implemented|unimplemented|TODO|FIXME/i]",
          message:
            "Stub implementation. Finish the function or delete it — don't ship a placeholder throw.",
        },
      ],
    },
  },
]);

export default eslintConfig;
