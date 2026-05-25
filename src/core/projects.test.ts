import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import {
  createProject,
  deleteProject,
  listProjects,
  reorderProject,
} from "./projects";
import { createTestDb } from "./test-helpers";

describe("projects", () => {
  it("creates projects in insertion order at the end", () => {
    const { db } = createTestDb();
    createProject(db, { name: "A" }, "web");
    createProject(db, { name: "B" }, "mcp");
    createProject(db, { name: "C" }, "web");
    expect(listProjects(db).map((p) => p.name)).toEqual(["A", "B", "C"]);
  });

  it("reorders a project after another", () => {
    const { db } = createTestDb();
    const a = createProject(db, { name: "A" }, "web");
    createProject(db, { name: "B" }, "web");
    const c = createProject(db, { name: "C" }, "web");

    reorderProject(db, c.id, "after:" + a.id, "web");
    expect(listProjects(db).map((p) => p.name)).toEqual(["A", "C", "B"]);
  });

  it("threads source through to audit", () => {
    const { db } = createTestDb();
    const p = createProject(db, { name: "X" }, "mcp");
    const entry = listAudit(db).find(
      (e) => e.entityType === "project" && e.entityId === p.id,
    );
    expect(entry?.source).toBe("mcp");
    expect(entry?.action).toBe("create");
  });

  it("keeps audit rows after the project is deleted (no cascade)", () => {
    const { db } = createTestDb();
    const p = createProject(db, { name: "Doomed" }, "web");
    deleteProject(db, p.id, "web");

    const rows = listAudit(db, { projectId: p.id });
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(["create", "delete"]);
  });
});
