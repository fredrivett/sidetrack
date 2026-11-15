import { eq, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { createApiKey, revokeApiKey, verifyApiKey } from "./api-keys";
import { listAudit, recordAudit } from "./audit";
import { addItem, deleteItem, setItemParent, updateItem } from "./items";
import { createProject } from "./projects";
import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";
import { createTestDb, createTestUser } from "./test-helpers";
import { setAvatarUrl } from "./users";

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
    addItem(db, u, { projectId: p.id, title: "via-web" }, "web");
    addItem(db, u, { projectId: p.id, title: "via-mcp" }, "mcp");

    const webOnly = listAudit(db, u, { source: "web" });
    expect(webOnly.every((e) => e.source === "web")).toBe(true);
    const mcpOnly = listAudit(db, u, { source: "mcp" });
    expect(mcpOnly.every((e) => e.source === "mcp")).toBe(true);
    expect(webOnly.length + mcpOnly.length).toBe(listAudit(db, u).length);
  });

  it("records which agent made a change, and keeps it after the key is revoked", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const { record, plaintext } = createApiKey(db, u, "Claude desktop", "web");
    const caller = verifyApiKey(db, plaintext);
    expect(caller).toEqual({ userId: u, keyId: record.id, name: "Claude desktop" });

    const p = createProject(db, u, { name: "Home" }, "web");
    addItem(
      db,
      u,
      { projectId: p.id, title: "Water plants" },
      { source: "mcp", agent: { keyId: record.id, name: record.name } },
    );
    // Revoking deletes the key row; the log must still name the agent.
    revokeApiKey(db, u, record.id, "web");

    const entries = listAudit(db, u);
    expect(
      entries.find((e) => e.entityType === "item" && e.action === "create"),
    ).toMatchObject({
      source: "mcp",
      agentKeyId: record.id,
      agentName: "Claude desktop",
    });
    expect(entries.find((e) => e.entityType === "project")).toMatchObject({
      source: "web",
      agentKeyId: null,
      agentName: null,
    });
  });

  it("returns rows newest first", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "P" }, "web");
    addItem(db, u, { projectId: p.id, title: "older" }, "web");
    addItem(db, u, { projectId: p.id, title: "newer" }, "web");

    const rows = listAudit(db, u);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].ts).toBeGreaterThanOrEqual(rows[i].ts);
    }
  });

  it("clamps limit to the [1, 500] range", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const p = createProject(db, u, { name: "P" }, "web");
    addItem(db, u, { projectId: p.id, title: "x" }, "web");
    addItem(db, u, { projectId: p.id, title: "y" }, "web");

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

  it("resolves the actor's display name and avatar (null for an unknown actor)", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, {
      email: "alice@test.local",
      name: "Alice Example",
    });
    setAvatarUrl(db, alice, "https://example.com/alice.png", "web");
    const p = createProject(db, alice, { name: "Alice" }, "web");
    recordOnProject(db, "ghost-user", p.id); // actor not in users table

    const rows = listAudit(db, alice);
    const mine = rows.find((e) => e.actor === alice);
    expect(mine?.actorName).toBe("Alice Example");
    expect(mine?.actorImage).toBe("https://example.com/alice.png");
    const ghost = rows.find((e) => e.actor === "ghost-user");
    expect(ghost?.actorName).toBeNull();
    expect(ghost?.actorImage).toBeNull();
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

  it("item view shows that item's and its sub-items' history, and only to someone with access", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, { email: "alice@test.local" });
    const bob = createTestUser(db, { email: "bob@test.local" });
    const p = createProject(db, alice, { name: "Alice" }, "web");
    const item = addItem(db, alice, { projectId: p.id, title: "Item" }, "web");
    const sub = addItem(db, alice, { projectId: p.id, title: "Sub", parentId: item.id }, "web");
    const other = addItem(db, alice, { projectId: p.id, title: "Other" }, "web");
    addItem(db, alice, { projectId: p.id, title: "Other sub", parentId: other.id }, "web");
    updateItem(db, alice, item.id, { title: "Renamed" }, "web");
    updateItem(db, alice, sub.id, { title: "Sub renamed" }, "web");
    // A sub-item since deleted, one moved out (then changed elsewhere), and a
    // top-level item moved in (after changes of its own).
    const gone = addItem(db, alice, { projectId: p.id, title: "Gone", parentId: item.id }, "web");
    deleteItem(db, alice, gone.id, "web");
    const leaver = addItem(db, alice, { projectId: p.id, title: "Leaver", parentId: item.id }, "web");
    setItemParent(db, alice, leaver.id, null, "web");
    updateItem(db, alice, leaver.id, { title: "Left" }, "web");
    const joiner = addItem(db, alice, { projectId: p.id, title: "Joiner" }, "web");
    updateItem(db, alice, joiner.id, { title: "Joined" }, "web");
    setItemParent(db, alice, joiner.id, item.id, "web");

    // Its own rows and what happened to each sub-item while it was one,
    // deleted or not; not the list's other items', nor their sub-items'.
    const rows = listAudit(db, alice, { itemId: item.id });
    expect(rows.map((e) => [e.action, e.entityId]).sort()).toEqual(
      [
        ["create", item.id],
        ["update", item.id],
        ["create", sub.id],
        ["update", sub.id],
        ["create", gone.id],
        ["delete", gone.id],
        ["create", leaver.id],
        ["update", leaver.id], // moved out
        ["update", joiner.id], // made a sub-item
      ].sort(),
    );

    // A sub-item's own view is just its rows.
    expect(listAudit(db, alice, { itemId: sub.id }).every((e) => e.entityId === sub.id)).toBe(true);

    // Someone without access to its list gets nothing.
    expect(listAudit(db, bob, { itemId: item.id })).toEqual([]);
  });
});

// Every table, by whether changes to it are audited. A new table fails the
// test below until it's added here, so whether its changes are audited is a
// decision someone made. Individual exempt writes to audited tables are
// marked `audit-exempt` where they happen (lint enforces that).
const TABLE_AUDIT: Record<string, "audited" | `exempt: ${string}`> = {
  projects: "audited",
  project_positions: "audited",
  project_members: "audited",
  spaces: "audited",
  space_members: "audited",
  items: "audited",
  item_pr_links: "audited",
  categories: "audited",
  api_keys: "audited",
  agent_sessions: "audited",
  github_webhooks: "audited",
  github_webhook_secrets: "audited",
  users: "audited",
  avatars: "audited",
  audit_log: "exempt: the log itself",
  meta: "exempt: app bookkeeping (sign-up lock, last backup time)",
  sessions: "exempt: Better Auth sign-in state",
  // Password changes and resets, by a trigger (migration 0021).
  accounts: "audited",
  verifications: "exempt: Better Auth one-time tokens (password reset)",
};

describe("audit coverage", () => {
  it("classifies every table as audited or exempt", () => {
    const tables = Object.values({ ...appSchema, ...authSchema })
      .filter((value) => is(value, SQLiteTable))
      .map((table) => getTableName(table as SQLiteTable));
    expect(tables.sort()).toEqual(Object.keys(TABLE_AUDIT).sort());
  });
});

describe("password audit", () => {
  // Better Auth writes accounts itself; these writes mirror its own, so the
  // trigger is what's under test.
  it("logs each password change, telling a reset-link change apart", () => {
    const { db } = createTestDb();
    const userId = createTestUser(db);
    const other = createTestUser(db);
    const now = new Date();
    const account = (id: string, user: string) => ({
      id,
      accountId: user,
      providerId: "credential",
      userId: user,
      password: "hash-0",
      createdAt: now,
      updatedAt: now,
    });
    db.insert(authSchema.accounts).values([account("a1", userId), account("a2", other)]).run();
    const setPassword = (id: string, password: string) =>
      db.update(authSchema.accounts).set({ password }).where(eq(authSchema.accounts.id, id)).run();
    const passwordLog = (user: string) =>
      listAudit(db, user)
        .filter((e) => e.entityType === "profile")
        .map((e) => [e.action, e.detail, e.actor, e.entityId, e.source]);

    setPassword("a1", "hash-1");
    // Writes that leave the password alone aren't logged.
    db.update(authSchema.accounts).set({ scope: "x" }).where(eq(authSchema.accounts.id, "a1")).run();
    setPassword("a1", "hash-1");
    expect(passwordLog(userId)).toEqual([["update", "password", userId, userId, "web"]]);

    // Mid-reset, the user's unexpired token is present; another user's isn't theirs.
    const token = (id: string, value: string, expiresAt: Date) => ({
      id,
      identifier: `reset-password:${id}`,
      value,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    const soon = new Date(Date.now() + 60_000);
    db.insert(authSchema.verifications)
      .values([
        token("used", userId, soon),
        token("also-sent", userId, soon),
        token("theirs", other, new Date(Date.now() - 60_000)),
        // Not a reset link: left alone.
        { ...token("other-kind", userId, soon), identifier: "email-verification:x" },
      ])
      .run();
    const links = () =>
      db.select({ id: authSchema.verifications.id }).from(authSchema.verifications).all()
        .map((v) => v.id)
        .sort();

    setPassword("a1", "hash-2");
    // Every reset link the user held is cancelled with the change, not just
    // the one used; another user's links and other kinds of token stay.
    expect(links()).toEqual(["other-kind", "theirs"]);
    // So the next change, with no reset in flight, is an ordinary one.
    setPassword("a1", "hash-3");
    setPassword("a2", "hash-2"); // expired token: an ordinary change
    expect(links()).toEqual(["other-kind"]);
    expect(passwordLog(userId)).toHaveLength(3);
    expect(passwordLog(userId).map((r) => r[1])).toEqual(
      expect.arrayContaining(["password", "password via a reset link"]),
    );
    expect(passwordLog(userId).filter((r) => r[1] === "password via a reset link")).toHaveLength(1);
    expect(passwordLog(other)).toEqual([["update", "password", other, other, "web"]]);
  });
});
