import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import { addItem } from "./items";
import { createProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

describe("audit", () => {
  it("filters by source", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "P" }, "web");
    addItem(db, u, { projectId: p.id, kind: "task", title: "via-web" }, "web");
    addItem(db, u, { projectId: p.id, kind: "task", title: "via-mcp" }, "mcp");

    const webOnly = listAudit(db, u, { source: "web" });
    expect(webOnly.every((e) => e.source === "web")).toBe(true);
    const mcpOnly = listAudit(db, u, { source: "mcp" });
    expect(mcpOnly.every((e) => e.source === "mcp")).toBe(true);
    expect(webOnly.length + mcpOnly.length).toBe(listAudit(db, u).length);
  });

  it("returns rows newest first", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "P" }, "web");
    addItem(db, u, { projectId: p.id, kind: "task", title: "older" }, "web");
    addItem(db, u, { projectId: p.id, kind: "task", title: "newer" }, "web");

    const rows = listAudit(db, u);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].ts).toBeGreaterThanOrEqual(rows[i].ts);
    }
  });

  it("clamps limit to the [1, 500] range", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "P" }, "web");
    addItem(db, u, { projectId: p.id, kind: "task", title: "x" }, "web");
    addItem(db, u, { projectId: p.id, kind: "task", title: "y" }, "web");

    expect(listAudit(db, u, { limit: 1 }).length).toBe(1);
    expect(listAudit(db, u, { limit: 0 }).length).toBeGreaterThanOrEqual(1);
  });

  it("scopes audit rows to the acting user", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, { email: "alice@test.local" });
    const bob = createTestUser(db, { email: "bob@test.local" });
    createProject(db, alice, { name: "Alice" }, "web");
    createProject(db, bob, { name: "Bob" }, "web");

    expect(listAudit(db, alice).every((e) => e.actor === alice)).toBe(true);
    expect(listAudit(db, bob).every((e) => e.actor === bob)).toBe(true);
  });
});
