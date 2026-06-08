import { describe, expect, it } from "vitest";
import { listAudit, recordAudit } from "./audit";
import { addItem } from "./items";
import { createProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

// The write-path ownership checks stop one user mutating another's project,
// so a foreign actor on your project can't arise through the public core API
// today (it's the seam for future shared projects / webhook bots). To test
// the read-scoping directly, insert such rows with recordAudit.
function recordOnProject(
  db: ReturnType<typeof createTestDb>["db"],
  actor: string,
  projectId: string,
) {
  recordAudit(db, {
    actor,
    source: "web",
    action: "update",
    entityType: "item",
    entityId: "x",
    projectId,
    detail: "foreign actor touched this project",
  });
}

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

  it("all-projects view shows every actor's activity on your projects", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, { email: "alice@test.local" });
    const bob = createTestUser(db, { email: "bob@test.local" });
    const p = createProject(db, alice, { name: "Alice" }, "web");
    recordOnProject(db, bob, p.id); // bob acts on alice's project

    const actors = listAudit(db, alice).map((e) => e.actor);
    expect(actors).toContain(alice);
    expect(actors).toContain(bob);
  });

  it("all-projects view hides activity on other users' projects", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, { email: "alice@test.local" });
    const bob = createTestUser(db, { email: "bob@test.local" });
    createProject(db, alice, { name: "Alice" }, "web");
    const bobsProject = createProject(db, bob, { name: "Bob" }, "web");

    const alicesView = listAudit(db, alice);
    expect(alicesView.every((e) => e.projectId !== bobsProject.id)).toBe(true);
    expect(alicesView.some((e) => e.detail.includes("Alice"))).toBe(true);
  });

  it("all-projects view excludes your own rows on a project you don't own", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, { email: "alice@test.local" });
    const bob = createTestUser(db, { email: "bob@test.local" });
    const bobsProject = createProject(db, bob, { name: "Bob" }, "web");
    // A row alice authored on bob's still-live project must not leak into
    // alice's feed via the actor fallback — bob owns the project.
    recordOnProject(db, alice, bobsProject.id);

    expect(
      listAudit(db, alice).every((e) => e.projectId !== bobsProject.id),
    ).toBe(true);
  });

  it("all-projects view includes the user's account-level events", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, { email: "alice@test.local" });
    // An event with no project (e.g. an API key mint) still belongs to alice.
    recordAudit(db, {
      actor: alice,
      source: "web",
      action: "create",
      entityType: "api_key",
      entityId: "k1",
      detail: "minted API key",
    });
    const rows = listAudit(db, alice);
    expect(rows.some((e) => e.entityType === "api_key")).toBe(true);
  });

  it("resolves the actor's display name (null for an unknown actor)", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, {
      email: "alice@test.local",
      name: "Alice Example",
    });
    const p = createProject(db, alice, { name: "Alice" }, "web");
    recordOnProject(db, "ghost-user", p.id); // actor not in users table

    const rows = listAudit(db, alice);
    expect(rows.find((e) => e.actor === alice)?.actorName).toBe("Alice Example");
    expect(rows.find((e) => e.actor === "ghost-user")?.actorName).toBeNull();
  });

  it("project view shows all actors but only to the project's owner", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, { email: "alice@test.local" });
    const bob = createTestUser(db, { email: "bob@test.local" });
    const p = createProject(db, alice, { name: "Alice" }, "web");
    recordOnProject(db, bob, p.id);

    // Owner sees every actor's activity on the project.
    const ownerView = listAudit(db, alice, { projectId: p.id });
    expect(ownerView.map((e) => e.actor)).toContain(bob);

    // A non-owner gets nothing, not another user's history.
    expect(listAudit(db, bob, { projectId: p.id })).toEqual([]);
  });
});
