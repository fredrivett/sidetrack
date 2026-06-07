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
      // Other escape hatches agents reach for when the type fights them.
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      // Leftover debug logging. Operational CLI entrypoints re-enable this below.
      "no-console": "error",
      // `// TODO` / `// FIXME` left in place of finishing the work.
      "no-warning-comments": [
        "error",
        { terms: ["todo", "fixme"], location: "anywhere" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ThrowStatement > NewExpression[callee.name='Error'][arguments.0.value=/not implemented|unimplemented|TODO|FIXME/i]",
          message:
            "Stub implementation. Finish the function or delete it — don't ship a placeholder throw.",
        },
        {
          selector: "FunctionDeclaration > BlockStatement[body.length=0]",
          message:
            "Empty function body. Implement it or delete it — don't ship a stub.",
        },
        {
          selector:
            "MethodDefinition > FunctionExpression > BlockStatement[body.length=0]",
          message:
            "Empty method body. Implement it or delete it — don't ship a stub.",
        },
      ],
    },
  },
  // Operational CLI entrypoints log progress to the console by design.
  {
    files: ["src/core/backup.ts", "src/core/migrate.ts", "scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
]);

export default eslintConfig;
