/**
 * Local ESLint rule: enforce the audit-log invariant (AGENTS.md). Any
 * `db.transaction` whose body mutates (insert/update/delete) must also call
 * `recordAudit` in the same transaction — the deterministic in-loop guard
 * behind the convention. Direct, un-transactioned writes (recordAudit's own
 * insert, ensureCategory, backup) sit outside a transaction callback and are
 * intentionally exempt.
 *
 * Tested in audit-in-transaction.test.ts — both directions, plus the exemption.
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
};

/** Packaged as an ESLint plugin for flat config. */
export const auditPlugin = {
  rules: { "audit-in-transaction": auditInTransaction },
};
