import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import { rethrowRedirectPlugin } from "./rethrow-redirect.mjs";

const linter = new Linter();

const IMPORTS = `
  import { saveAction, removeAction } from "@/app/actions";
  import { unstable_rethrow } from "next/navigation";
  import { normalizeWebUrl } from "@/lib/url";
`;

/** Run the rule over a snippet (after the imports above) and return the lint messages. */
function lint(code) {
  return linter.verify(IMPORTS + code, {
    plugins: { redirect: rethrowRedirectPlugin },
    rules: { "redirect/rethrow-redirect": "error" },
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
  });
}

describe("rethrow-redirect", () => {
  it("passes a try/catch around an action that rethrows first", () => {
    expect(
      lint(`
        async function save() {
          try {
            await saveAction(1);
          } catch (e) {
            unstable_rethrow(e);
            setError(e.message);
          }
        }
      `),
    ).toEqual([]);
  });

  it("flags a try/catch around an action that doesn't rethrow", () => {
    const messages = lint(`
      async function save() {
        try {
          await saveAction(1);
        } catch {
          setError("Couldn't save.");
        }
      }
    `);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe("missingRethrow");
    expect(
      lint(`
        async function save() {
          try { await saveAction(1); } catch (e) { setError(e.message); }
        }
      `),
    ).toHaveLength(1);
  });

  it("requires the rethrow first, of the caught error", () => {
    expect(
      lint(`
        async function save() {
          try { await saveAction(1); } catch (e) {
            if (stale) return;
            unstable_rethrow(e);
          }
        }
      `),
    ).toHaveLength(1);
    expect(
      lint(`
        async function save() {
          try { await saveAction(1); } catch (e) { unstable_rethrow(other); }
        }
      `),
    ).toHaveLength(1);
  });

  it("checks .catch on an action's promise, inline handlers only", () => {
    expect(lint(`saveAction(1).then(show).catch(() => {});`)).toHaveLength(1);
    expect(lint(`saveAction(1).catch(handle);`)).toHaveLength(1);
    expect(
      lint(`saveAction(1).catch((e) => { setError(e); unstable_rethrow(e); });`),
    ).toHaveLength(1);
    expect(lint(`saveAction(1).catch((e) => unstable_rethrow(e));`)).toEqual([]);
    expect(
      lint(`saveAction(1).catch((e) => { unstable_rethrow(e); return null; });`),
    ).toEqual([]);
  });

  it("checks .then's rejection handler, not a lone fulfilment handler", () => {
    expect(lint(`saveAction(1).then(show, (e) => { if (open) throw e; });`)).toHaveLength(1);
    expect(
      lint(`saveAction(1).then(show, (e) => { unstable_rethrow(e); if (open) throw e; });`),
    ).toEqual([]);
    expect(lint(`saveAction(1).then(show);`)).toEqual([]);
  });

  it("ignores catches that don't guard an action", () => {
    expect(
      lint(`
        try { normalizeWebUrl(raw); } catch { toast.error("Bad URL"); }
        fetch("/x").catch(() => {});
        runAction(saveAction(1), "save");
      `),
    ).toEqual([]);
  });

  it("follows a local function that calls an action", () => {
    expect(
      lint(`
        async function run() {
          try { await persist(); } catch { setError("Couldn't save."); }
        }
        const persist = async () => {
          await removeAction(2);
        };
      `),
    ).toHaveLength(1);
  });

  it("follows an action passed in as an argument", () => {
    // GithubWebhookPanel's shape: run() catches whatever it's handed.
    const code = (handler) => `
      function run(action) {
        startTransition(async () => {
          try { await action(); } catch (e) { ${handler} }
        });
      }
      const remove = () => run(async () => { await removeAction(1); });
    `;
    expect(lint(code(`setError(e.message);`))).toHaveLength(1);
    expect(lint(code(`unstable_rethrow(e); setError(e.message);`))).toEqual([]);
    // Handed the action itself, not a wrapper.
    expect(
      lint(`
        function run(action) {
          try { action(); } catch { setError("x"); }
        }
        run(saveAction);
      `),
    ).toHaveLength(1);
    // A caller that only passes something else doesn't count.
    expect(
      lint(`
        function run(work) {
          try { work(); } catch { setError("x"); }
        }
        run(() => normalizeWebUrl(raw));
      `),
    ).toEqual([]);
  });

  it("follows aliases, actions handed to other calls, and mutual recursion", () => {
    expect(
      lint(`
        const save = saveAction;
        async function run() {
          try { await save(1); } catch { setError("x"); }
        }
      `),
    ).toHaveLength(1);
    expect(
      lint(`
        async function removeAll(ids) {
          try { await Promise.all(ids.map(removeAction)); } catch { setError("x"); }
        }
      `),
    ).toHaveLength(1);
    // Checking a calls b, b calls a, then a calls the action: b reaches it
    // too, though b was checked while a's check was still open.
    expect(
      lint(`
        try { a(); } catch { setError("x"); }
        try { b(); } catch { setError("y"); }
        function a() { if (x) b(); saveAction(1); }
        function b() { if (y) a(); }
      `),
    ).toHaveLength(2);
  });

  it("looks inside callbacks and namespace imports in the guarded code", () => {
    expect(
      lint(`
        async function removeAll(ids) {
          try { await Promise.all(ids.map((id) => removeAction(id))); } catch { setError("x"); }
        }
      `),
    ).toHaveLength(1);
    expect(
      linter.verify(
        `
          import * as actions from "@/app/actions";
          actions.saveAction(1).catch(() => {});
        `,
        {
          plugins: { redirect: rethrowRedirectPlugin },
          rules: { "redirect/rethrow-redirect": "error" },
          languageOptions: { ecmaVersion: 2022, sourceType: "module" },
        },
      ),
    ).toHaveLength(1);
  });
});
