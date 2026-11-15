import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import { auditPlugin } from "./audit-in-transaction.mjs";

const linter = new Linter();

/** Run the audit rule over a snippet and return the lint messages. */
function lint(code) {
  return linter.verify(code, {
    plugins: { audit: auditPlugin },
    rules: { "audit/audit-in-transaction": "error" },
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
  });
}

describe("audit-in-transaction", () => {
  it("passes a transaction that mutates and records audit", () => {
    const messages = lint(`
      db.transaction((tx) => {
        tx.insert(items).values({}).run();
        recordAudit(tx, { action: "create" });
      });
    `);
    expect(messages).toEqual([]);
  });

  it("flags a mutating transaction with no recordAudit", () => {
    const messages = lint(`
      db.transaction((tx) => {
        tx.delete(items).where(eq(items.id, id)).run();
      });
    `);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe("missingAudit");
  });

  it("flags update and insert too, not just delete", () => {
    expect(
      lint(`db.transaction((tx) => { tx.update(items).set({}).run(); });`),
    ).toHaveLength(1);
    expect(
      lint(`db.transaction((tx) => { tx.insert(items).values({}).run(); });`),
    ).toHaveLength(1);
  });

  it("flags a write outside a transaction that isn't marked exempt", () => {
    const messages = lint(`db.insert(categories).values({}).run();`);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe("unauditedWrite");
    // A marker with no reason doesn't count.
    expect(
      lint(`
        // audit-exempt:
        db.update(users).set({}).run();
      `),
    ).toHaveLength(1);
  });

  it("accepts a marked write, above the statement or an enclosing function", () => {
    expect(
      lint(`
        // audit-exempt: telemetry, not a user action
        db.update(apiKeys).set({}).run();
      `),
    ).toEqual([]);
    expect(
      lint(`
        /** Does a thing. audit-exempt: the caller audits it */
        export function helper(tx) {
          if (x) {
            tx.update(items).set({}).run();
          }
        }
      `),
    ).toEqual([]);
  });

  it("ignores delete/update calls on things other than the DB handle", () => {
    expect(
      lint(`
        seen.delete(id);
        url.searchParams.delete("view");
        hash.update(data);
      `),
    ).toEqual([]);
  });

  it("ignores a read-only transaction", () => {
    const messages = lint(`
      db.transaction((tx) => {
        tx.select().from(items).all();
      });
    `);
    expect(messages).toEqual([]);
  });

  it("judges each transaction independently", () => {
    // First audits, second doesn't — exactly one report.
    const messages = lint(`
      db.transaction((tx) => { tx.insert(items).values({}).run(); recordAudit(tx, {}); });
      db.transaction((tx) => { tx.delete(items).run(); });
    `);
    expect(messages).toHaveLength(1);
  });

  it("flags an extracted (non-inline) transaction callback", () => {
    // The mutation can't be seen, so requiring inline forecloses the bypass.
    const messages = lint(`
      const cb = (tx) => { tx.delete(items).run(); };
      db.transaction(cb);
    `);
    // The extracted body's write is also reported, as one outside a transaction.
    expect(messages.map((m) => m.messageId).sort()).toEqual([
      "inlineCallback",
      "unauditedWrite",
    ]);
  });

  it("flags a non-inline callback even if it would audit", () => {
    // We can't verify an extracted callback, so it's rejected regardless.
    const messages = lint(`
      function run(tx) { tx.insert(items).values({}).run(); recordAudit(tx, {}); }
      db.transaction(run);
    `);
    // The extracted body's write is also reported, as one outside a transaction.
    expect(messages.map((m) => m.messageId).sort()).toEqual([
      "inlineCallback",
      "unauditedWrite",
    ]);
  });
});
