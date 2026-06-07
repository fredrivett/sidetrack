/**
 * Local ESLint rule: enforce the audit-log invariant (AGENTS.md). Any
 * `db.transaction` whose body mutates (insert/update/delete) must also call
 * `recordAudit` in the same transaction — the deterministic in-loop guard
 * behind the convention. Direct, un-transactioned writes (recordAudit's own
 * insert, ensureCategory, backup) sit outside a transaction callback and are
 * intentionally exempt.
 *
 * The check only sees an inline callback's body, so it also *requires* the
 * callback to be inline: an extracted callback (`db.transaction(cb)`) would
 * otherwise slip its mutations past enforcement. Current code always inlines,
 * so this only forecloses the bypass.
 *
 * `recordAudit` is matched by name — a fast heuristic, not a binding check. A
 * deliberately shadowed local `recordAudit` could spoof it, but that is out of
 * scope: this rule guards *accidental* omission (and a determined bypass can
 * just `eslint-disable` it). The real guarantee — that a row is actually
 * written — is covered by the behavioural tests in src/core/*.test.ts.
 *
 * Tested in audit-in-transaction.test.mjs — both directions, the exemption,
 * and the inline-callback requirement.
 */
export const auditInTransaction = {
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
      inlineCallback:
        "Pass the db.transaction() callback inline. An extracted callback can't be checked for recordAudit, so it would bypass the audit-log invariant — see AGENTS.md.",
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
    const isInlineFn = (node) =>
      node?.type === "ArrowFunctionExpression" ||
      node?.type === "FunctionExpression";
    return {
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      // A transaction callback must be inline, or its mutations can't be seen.
      "CallExpression[callee.property.name='transaction']"(node) {
        const arg = node.arguments[0];
        if (arg && !isInlineFn(arg)) {
          context.report({ node: arg, messageId: "inlineCallback" });
        }
      },
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
};

/** Packaged as an ESLint plugin for flat config. */
export const auditPlugin = {
  rules: { "audit-in-transaction": auditInTransaction },
};
