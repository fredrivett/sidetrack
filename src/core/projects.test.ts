import { describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  reorderProject,
  updateProject,
} from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

describe("projects", () => {
  it("creates projects in insertion order at the end", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    createProject(db, u, { name: "A" }, "web");
    createProject(db, u, { name: "B" }, "mcp");
    createProject(db, u, { name: "C" }, "web");
    expect(listProjects(db, u).map((p) => p.name)).toEqual(["A", "B", "C"]);
  });

  it("rejects a blank name on create", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    expect(() => createProject(db, u, { name: "   " }, "web")).toThrow(
      /name cannot be empty/,
    );
  });

  it("rejects clearing the name on update and leaves it unchanged", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "keep me" }, "web");
    expect(() => updateProject(db, u, p.id, { name: " " }, "web")).toThrow(
      /name cannot be empty/,
    );
    expect(getProject(db, u, p.id)?.name).toBe("keep me");
  });

  it("reorders a project after another", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const a = createProject(db, u, { name: "A" }, "web");
    createProject(db, u, { name: "B" }, "web");
    const c = createProject(db, u, { name: "C" }, "web");

    reorderProject(db, u, c.id, "after:" + a.id, "web");
    expect(listProjects(db, u).map((p) => p.name)).toEqual(["A", "C", "B"]);
  });

  it("threads source through to audit", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "X" }, "mcp");
    const entry = listAudit(db, u).find(
      (e) => e.entityType === "project" && e.entityId === p.id,
    );
    expect(entry?.source).toBe("mcp");
    expect(entry?.action).toBe("create");
  });

  it("keeps audit rows after the project is deleted (no cascade)", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "Doomed" }, "web");
    deleteProject(db, u, p.id, "web");

    // The project-scoped view can't authorize a now-deleted project, but the
    // rows survive (no cascade) and stay visible in the owner's all-projects
    // feed via the actor fallback — so the deletion itself remains auditable.
    expect(listAudit(db, u, { projectId: p.id })).toEqual([]);
    const rows = listAudit(db, u).filter((r) => r.entityId === p.id);
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(["create", "delete"]);
  });

  it("scopes projects to their owner", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, { email: "alice@test.local" });
    const bob = createTestUser(db, { email: "bob@test.local" });
    createProject(db, alice, { name: "Alice project" }, "web");
    createProject(db, bob, { name: "Bob project" }, "web");

    expect(listProjects(db, alice).map((p) => p.name)).toEqual([
      "Alice project",
    ]);
    expect(listProjects(db, bob).map((p) => p.name)).toEqual(["Bob project"]);
  });
});
