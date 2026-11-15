/**
 * Local ESLint rule: a catch around a Server Action lets Next's redirects
 * through (AGENTS.md, "Saving changes"). When the session has ended, an action
 * rejects with Next's redirect to /login; a handler that treats it as a
 * failure shows a bogus error ("NEXT_REDIRECT", "Couldn't …") on the way out.
 * So a try/catch, `.catch`, or `.then(onFulfilled, onRejected)` whose guarded
 * code calls an action imported from `@/app/actions` must start its handler
 * with `unstable_rethrow(error)`, or leave the catching to `runAction`, which
 * does.
 *
 * "Calls an action" follows calls within the file: a local function or alias
 * that calls one (`try { await save() }`), and a parameter that callers pass
 * one to, as in `run(action)` with `try { await action() }` and
 * `run(async () => { await removeAction() })`. Handing one to another call
 * counts (`ids.map(removeAction)`), and callbacks in the guarded code are
 * looked inside (`Promise.all(ids.map((id) => removeAction(id)))`). That
 * includes a callback that runs later, such as an event listener, which the
 * catch doesn't really guard: syntax can't tell it from one that's awaited,
 * and a needless rethrow is harmless where a missed one isn't.
 * Calls through other files, such as `runAction`, aren't followed.
 *
 * The handler must be inline so the rethrow can be seen, and the rethrow must
 * come first: a `return` before it would still swallow the redirect.
 * `unstable_rethrow` is matched by name, like `recordAudit` in
 * audit-in-transaction.mjs: this guards accidental omission, not a deliberate
 * bypass.
 *
 * Tested in rethrow-redirect.test.mjs.
 */
const ACTIONS_MODULE = "@/app/actions";

const isFn = (node) =>
  node?.type === "ArrowFunctionExpression" ||
  node?.type === "FunctionExpression" ||
  node?.type === "FunctionDeclaration";

export const rethrowRedirect = {
  meta: {
    type: "problem",
    docs: {
      description:
        "a catch around a Server Action must call unstable_rethrow(error) first",
    },
    schema: [],
    messages: {
      missingRethrow:
        "This catch handles a Server Action's error without calling unstable_rethrow(error) first. A signed-out session rejects with Next's redirect to /login, which isn't a failure to show. Start the (inline) handler with unstable_rethrow(error), or use runAction — see AGENTS.md, \"Saving changes\".",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const { visitorKeys } = sourceCode;

    // Calls each node in `node`'s subtree, nested functions included.
    const walk = (node, visit) => {
      visit(node);
      for (const key of visitorKeys[node.type] ?? []) {
        const child = node[key];
        for (const c of Array.isArray(child) ? child : [child]) {
          if (c && typeof c.type === "string") walk(c, visit);
        }
      }
    };

    const resolve = (identifier) => {
      for (let s = sourceCode.getScope(identifier); s; s = s.upper) {
        const v = s.set.get(identifier.name);
        if (v) return v;
      }
      return null;
    };

    const isActionsImport = (def) =>
      def?.type === "ImportBinding" && def.parent.source.value === ACTIONS_MODULE;

    // Reachability checks are memoized. A check still in progress
    // (recursion) counts as false for now, so a false found while another
    // check is open may rest on it, and is only kept once none is.
    const memo = new Map();
    const open = new Set();
    const cached = (key, compute) => {
      if (memo.has(key)) return memo.get(key);
      if (open.has(key)) return false;
      open.add(key);
      const result = compute();
      open.delete(key);
      if (result || open.size === 0) memo.set(key, result);
      return result;
    };

    // Whether `node`'s subtree calls an action, or hands one (or a local
    // function that calls one) to another call, as in `ids.map(removeAction)`.
    const reaches = (node) => {
      let found = false;
      walk(node, (n) => {
        if (found || n.type !== "CallExpression") return;
        found =
          callReaches(n) ||
          n.arguments.some((a) => a.type === "Identifier" && identifierReaches(a));
      });
      return found;
    };

    const fnReaches = (fn) => cached(fn, () => reaches(fn.body));

    // Whether a value named by `identifier` is, or calls, an action.
    const identifierReaches = (identifier) => {
      const def = resolve(identifier)?.defs[0];
      if (!def) return false;
      if (isActionsImport(def)) return def.node.type !== "ImportNamespaceSpecifier";
      if (def.type === "FunctionName") return fnReaches(def.node);
      if (def.type === "Variable") {
        const { init } = def.node;
        if (isFn(init)) return fnReaches(init);
        // An alias, as in `const save = saveAction`.
        return (
          init?.type === "Identifier" && cached(def.node, () => identifierReaches(init))
        );
      }
      if (def.type === "Parameter") {
        const index = def.node.params.indexOf(def.name);
        return index >= 0 && paramReaches(def.node, index);
      }
      return false;
    };

    // Whether any caller of `fn` passes an action, or a function that calls
    // one, as its `index`th argument.
    const paramReaches = (fn, index) =>
      cached(`${fn.range[0]}:${index}`, () => {
        const binding =
          fn.type === "FunctionDeclaration"
            ? fn
            : fn.parent.type === "VariableDeclarator" && fn.parent.init === fn
              ? fn.parent
              : null;
        return (binding ? sourceCode.getDeclaredVariables(binding) : []).some((v) =>
          v.references.some(({ identifier }) => {
            const call = identifier.parent;
            if (call.type !== "CallExpression" || call.callee !== identifier) return false;
            const arg = call.arguments[index];
            if (isFn(arg)) return fnReaches(arg);
            return arg?.type === "Identifier" && identifierReaches(arg);
          }),
        );
      });

    const callReaches = (call) => {
      const { callee } = call;
      if (callee.type === "Identifier") return identifierReaches(callee);
      // `import * as actions from "@/app/actions"; actions.saveAction()`
      return (
        callee.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        isActionsImport(resolve(callee.object)?.defs[0])
      );
    };

    // `unstable_rethrow(param)` as a statement or expression.
    const isRethrowOf = (node, param) =>
      node?.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "unstable_rethrow" &&
      node.arguments[0]?.type === "Identifier" &&
      node.arguments[0].name === param.name;
    // Whether a catch clause, or a promise's rejection handler, starts with
    // `unstable_rethrow` of what it caught. A handler that isn't inline can't
    // be seen, so it doesn't.
    const startsWithRethrow = (handler) => {
      const param = handler?.type === "CatchClause" ? handler.param : isFn(handler) && handler.params[0];
      if (param?.type !== "Identifier") return false;
      const { body } = handler;
      return body.type === "BlockStatement"
        ? body.body[0]?.type === "ExpressionStatement" &&
            isRethrowOf(body.body[0].expression, param)
        : isRethrowOf(body, param);
    };

    // Calls are resolved once the whole file is seen, so a function declared
    // after the catch, or a caller further down, still counts. Each entry is
    // [guarded code, handler, node to report].
    const catches = [];
    return {
      TryStatement(node) {
        if (node.handler) catches.push([node.block, node.handler, node.handler]);
      },
      // `.catch(onRejected)` and `.then(onFulfilled, onRejected)`.
      "CallExpression[callee.type='MemberExpression']"(node) {
        const { object, property } = node.callee;
        const handler =
          property.name === "catch"
            ? node.arguments[0]
            : property.name === "then"
              ? node.arguments[1]
              : undefined;
        if (handler) catches.push([object, handler, property]);
      },
      "Program:exit"() {
        for (const [guarded, handler, at] of catches) {
          if (!startsWithRethrow(handler) && reaches(guarded)) {
            context.report({ node: at, messageId: "missingRethrow" });
          }
        }
      },
    };
  },
};

/** Packaged as an ESLint plugin for flat config. */
export const rethrowRedirectPlugin = {
  rules: { "rethrow-redirect": rethrowRedirect },
};
