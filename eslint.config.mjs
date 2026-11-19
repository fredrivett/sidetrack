import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
// Local audit-log-invariant rule, defined and tested in eslint-rules/.
import { auditPlugin } from "./eslint-rules/audit-in-transaction.mjs";
// Local rule: catches around Server Actions let Next's redirects through.
import { rethrowRedirectPlugin } from "./eslint-rules/rethrow-redirect.mjs";

const AI_READ =
  "Asking an AI in a Server Action holds up every save behind it. Add an AI read in src/app/api/ai/reads.ts instead.";

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
    // Stryker's sandbox copies (with injected @ts-nocheck) and HTML report.
    ".stryker-tmp/**",
    "reports/**",
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
  // better-auth.ts logs once when the first user adopts legacy 'me' data —
  // a one-time data migration the operator should see in the logs.
  // email.ts logs password-reset links when no email provider is configured —
  // the self-hosted delivery channel, not leftover debugging.
  {
    files: [
      "src/core/backup.ts",
      "src/core/migrate.ts",
      "src/auth/better-auth.ts",
      "src/lib/email.ts",
      "scripts/**/*.ts",
    ],
    rules: { "no-console": "off" },
  },
  // Audit-log invariant: every DB write is audited in its transaction or marked
  // audit-exempt. Tests write fixtures directly.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/core/test-helpers.ts"],
    plugins: { audit: auditPlugin },
    rules: { "audit/audit-in-transaction": "error" },
  },
  // A catch around a Server Action calls unstable_rethrow first, so a
  // signed-out session's redirect to /login isn't shown as an error (AGENTS.md,
  // "Saving changes"). Tests catch mocked actions' rejections on purpose.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    plugins: { redirect: rethrowRedirectPlugin },
    rules: { "redirect/rethrow-redirect": "error" },
  },
  // A read that asks an AI is an AI read (src/app/api/ai/reads.ts), not a
  // Server Action: Next runs Server Actions one at a time, so a slow model
  // would hold up every save behind it (src/app/AGENTS.md).
  {
    files: ["src/app/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...["@/lib/jev", "@/lib/itemSuggest", "@/lib/feedbackFollowUps", "@/lib/greetingJev", "@/lib/greetingWriter"].map(
              (name) => ({ name, allowTypeImports: true, message: AI_READ }),
            ),
            { name: "@/lib/emojiSuggest", importNames: ["suggestEmoji", "suggestLabelEmoji"], message: AI_READ },
            { name: "@/core/agendaGreeting", importNames: ["writtenGreetingFor"], message: AI_READ },
            { name: "@/core/feedback", importNames: ["feedbackFollowUps"], message: AI_READ },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
