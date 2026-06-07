import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Local rule: enforce the audit-log invariant (AGENTS.md). Any `db.transaction`
// whose body mutates (insert/update/delete) must also call `recordAudit` in the
// same transaction — the deterministic in-loop guard behind the convention.
// Direct, un-transactioned writes (recordAudit's own insert, ensureCategory,
// backup) are outside a transaction callback and so are intentionally exempt.
const auditInvariantPlugin = {
  rules: {
    "audit-in-transaction": {
      meta: {
        type: "problem",
        docs: {
          description:
            "every db.transaction() that mutates must record audit in the same transaction",
        },
        schema: [],
        messages: {
          missingAudit:
            "Mutation inside db.transaction() without recordAudit(). Every state-changing DB op must write an audit_log row in the same transaction — see AGENTS.md.",
        },
      },
      create(context) {
        const stack = [];
        const isTxnCallback = (node) =>
          node.parent?.type === "CallExpression" &&
          node.parent.callee?.type === "MemberExpression" &&
          node.parent.callee.property?.name === "transaction" &&
          node.parent.arguments[0] === node;
        const enter = (node) => {
          if (isTxnCallback(node)) {
            stack.push({ node, mutates: false, audits: false });
          }
        };
        const exit = (node) => {
          if (!isTxnCallback(node)) return;
          const frame = stack.pop();
          if (frame.mutates && !frame.audits) {
            context.report({ node, messageId: "missingAudit" });
          }
        };
        return {
          ArrowFunctionExpression: enter,
          "ArrowFunctionExpression:exit": exit,
          FunctionExpression: enter,
          "FunctionExpression:exit": exit,
          CallExpression(node) {
            if (!stack.length) return;
            const top = stack[stack.length - 1];
            const callee = node.callee;
            if (
              callee.type === "MemberExpression" &&
              ["insert", "update", "delete"].includes(callee.property?.name)
            ) {
              top.mutates = true;
            }
            if (callee.type === "Identifier" && callee.name === "recordAudit") {
              top.audits = true;
            }
          },
        };
      },
    },
  },
};

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
  // Audit-log invariant — transactions live only in the domain layer.
  {
    files: ["src/core/**/*.ts"],
    plugins: { audit: auditInvariantPlugin },
    rules: { "audit/audit-in-transaction": "error" },
  },
]);

export default eslintConfig;
