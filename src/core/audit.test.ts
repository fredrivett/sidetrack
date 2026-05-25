import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import { addItem } from "./items";
import { createProject } from "./projects";
import { createTestDb } from "./test-helpers";

describe("audit", () => {
  it("filters by source", () => {
    const { db } = createTestDb();
    const p = createProject(db, { name: "P" }, "web");
    addItem(db, { projectId: p.id, kind: "task", title: "via-web" }, "web");
    addItem(db, { projectId: p.id, kind: "task", title: "via-mcp" }, "mcp");

    const webOnly = listAudit(db, { source: "web" });
    expect(webOnly.every((e) => e.source === "web")).toBe(true);
    const mcpOnly = listAudit(db, { source: "mcp" });
    expect(mcpOnly.every((e) => e.source === "mcp")).toBe(true);
    expect(webOnly.length + mcpOnly.length).toBe(listAudit(db).length);
  });

  it("returns rows newest first", () => {
    const { db } = createTestDb();
    const p = createProject(db, { name: "P" }, "web");
    addItem(db, { projectId: p.id, kind: "task", title: "older" }, "web");
    addItem(db, { projectId: p.id, kind: "task", title: "newer" }, "web");

    const rows = listAudit(db);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].ts).toBeGreaterThanOrEqual(rows[i].ts);
    }
  });

  it("clamps limit to the [1, 500] range", () => {
    const { db } = createTestDb();
    const p = createProject(db, { name: "P" }, "web");
    addItem(db, { projectId: p.id, kind: "task", title: "x" }, "web");
    addItem(db, { projectId: p.id, kind: "task", title: "y" }, "web");

    expect(listAudit(db, { limit: 1 }).length).toBe(1);
    expect(listAudit(db, { limit: 0 }).length).toBeGreaterThanOrEqual(1);
  });
});
