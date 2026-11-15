/**
 * Local ESLint rule: a catch around a Server Action lets Next's redirects
 * through (AGENTS.md, "Saving changes"). When the session has ended, an action
 * rejects with Next's redirect to /login; a handler that treats it as a
 * failure shows a bogus error ("NEXT_REDIRECT", "Couldn't …") on the way out.
 * So a try/catch or `.catch` whose guarded code calls an action imported from
 * `@/app/actions` must start its handler with `unstable_rethrow(error)`, or
 * leave the catching to `runAction`, which does.
 *
 * "Calls an action" follows calls within the file: a local function that
 * calls one (`try { await save() }`), and a parameter that callers pass one
 * to, as in `run(action)` with `try { await action() }` and
 * `run(async () => { await removeAction() })`. It looks inside callbacks in
 * the guarded code too (`Promise.all(ids.map((id) => removeAction(id)))`).
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

    // Memoized; a function still being checked (recursion) counts as false.
    const fnMemo = new Map();
    const fnReaches = (fn) => {
      if (fnMemo.has(fn)) return fnMemo.get(fn);
      fnMemo.set(fn, false);
      let found = false;
      walk(fn.body, (n) => {
        if (!found && n.type === "CallExpression" && callReaches(n)) found = true;
      });
      fnMemo.set(fn, found);
      return found;
    };

    // Whether a value named by `identifier` is, or calls, an action.
    const identifierReaches = (identifier) => {
      const def = resolve(identifier)?.defs[0];
      if (!def) return false;
      if (isActionsImport(def)) return def.node.type !== "ImportNamespaceSpecifier";
      if (def.type === "FunctionName") return fnReaches(def.node);
      if (def.type === "Variable" && isFn(def.node.init)) return fnReaches(def.node.init);
      if (def.type === "Parameter") {
        const index = def.node.params.indexOf(def.name);
        return index >= 0 && paramReaches(def.node, index);
      }
      return false;
    };

    // Whether any caller of `fn` passes an action, or a function that calls
    // one, as its `index`th argument.
    const paramMemo = new Map();
    const paramReaches = (fn, index) => {
      const key = `${fn.range[0]}:${index}`;
      if (paramMemo.has(key)) return paramMemo.get(key);
      paramMemo.set(key, false);
      const binding =
        fn.type === "FunctionDeclaration"
          ? fn
          : fn.parent.type === "VariableDeclarator" && fn.parent.init === fn
            ? fn.parent
            : null;
      const found = (binding ? sourceCode.getDeclaredVariables(binding) : []).some((v) =>
        v.references.some(({ identifier }) => {
          const call = identifier.parent;
          if (call.type !== "CallExpression" || call.callee !== identifier) return false;
          const arg = call.arguments[index];
          if (isFn(arg)) return fnReaches(arg);
          return arg?.type === "Identifier" && identifierReaches(arg);
        }),
      );
      paramMemo.set(key, found);
      return found;
    };

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

    const guardsAction = (node) => {
      let found = false;
      walk(node, (n) => {
        if (!found && n.type === "CallExpression" && callReaches(n)) found = true;
      });
      return found;
    };

    // `unstable_rethrow(param)` as a statement or expression.
    const isRethrowOf = (node, param) =>
      node?.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "unstable_rethrow" &&
      node.arguments[0]?.type === "Identifier" &&
      node.arguments[0].name === param.name;
    const startsWithRethrow = (param, body) =>
      param?.type === "Identifier" &&
      (body.type === "BlockStatement"
        ? body.body[0]?.type === "ExpressionStatement" &&
          isRethrowOf(body.body[0].expression, param)
        : isRethrowOf(body, param));

    // Calls are resolved once the whole file is seen, so a function declared
    // after the catch, or a caller further down, still counts.
    const catches = [];
    return {
      TryStatement(node) {
        if (node.handler) catches.push(node);
      },
      "CallExpression[callee.type='MemberExpression'][callee.property.name='catch']"(node) {
        catches.push(node);
      },
      "Program:exit"() {
        for (const node of catches) {
          if (node.type === "TryStatement") {
            const { handler } = node;
            if (guardsAction(node.block) && !startsWithRethrow(handler.param, handler.body)) {
              context.report({ node: handler, messageId: "missingRethrow" });
            }
            continue;
          }
          const fn = node.arguments[0];
          const ok = isFn(fn) && startsWithRethrow(fn.params[0], fn.body);
          if (!ok && guardsAction(node.callee.object)) {
            context.report({ node: node.callee.property, messageId: "missingRethrow" });
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
