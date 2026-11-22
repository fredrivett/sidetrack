import { eq, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { createApiKey, revokeApiKey, verifyApiKey } from "./api-keys";
import { listAudit, recordAudit } from "./audit";
import { addItem, completeItem, deleteItem, setItemParent, updateItem } from "./items";
import { acceptInvite, inviteMember } from "./members";
import { createProject } from "./projects";
import {
  acceptSpaceInvite,
  createSpace,
  inviteSpaceMember,
  removeSpaceMember,
  updateSpace,
} from "./spaces";
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
    event: { type: "item.reordered", projectId, itemId: "x", title: "foreign actor's item" },
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
      event: { type: "api_key.created", keyId: "k1", name: "Laptop", prefix: "st_ab" },
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
    expect(
      listAudit(db, alice, { itemId: sub.id }).map((e) => [e.action, e.entityId]).sort(),
    ).toEqual([
      ["create", sub.id],
      ["update", sub.id],
    ]);

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
  invitations: "audited",
  items: "audited",
  item_pr_links: "audited",
  item_ref_aliases: "audited",
  item_smart_matches: "audited",
  labels: "audited",
  api_keys: "audited",
  agent_sessions: "audited",
  agent_webhooks: "audited",
  comments: "audited",
  github_webhooks: "audited",
  email_addresses: "audited",
  inbound_emails: "exempt: received mail awaiting triage, seen only by its owner; acting on it is audited",
  sources: "exempt: a photo and its proposed lines awaiting review, seen only by its owner; adding them is audited",
  source_lines: "exempt: lines proposed from a photo, seen only by its owner; adding them is audited",
  github_webhook_secrets: "audited",
  users: "audited",
  avatars: "audited",
  calendar_accounts: "audited",
  calendars: "audited",
  calendar_events: "exempt: a cache of the owner's own calendar, rebuilt by sync",
  audit_log: "exempt: the log itself",
  agenda_greetings: "exempt: a cache of one person's greeting, seen by nobody else",
  day_notes: "exempt: one person's note about their day, for their greeting, seen by nobody else",
  meta: "exempt: app bookkeeping (sign-up lock, last backup time)",
  sessions: "exempt: Better Auth sign-in state",
  push_subscriptions: "exempt: where to deliver push on one device, like a session",
  item_follows: "exempt: who hears an item, per person and seen by nobody else",
  notification_settings: "exempt: how much someone hears, per person and seen by nobody else",
  notifications: "exempt: derived from the audit row written with it; read state is the reader's own",
  // Password changes and resets, by a trigger (migration 0021).
  accounts: "audited",
  // Two-factor sign-in turned on or off, and backup codes, by triggers on
  // users and two_factors (migration 0065); setup and removal of the row
  // itself go with the users change they make.
  two_factors: "audited",
  verifications: "exempt: Better Auth one-time tokens (password reset, two-factor sign-in, trusted devices)",
};

describe("change events", () => {
  it("shows an item by its current name, and by the one it had once it's gone", () => {
    const { db } = createTestDb();
    const fred = createTestUser(db, { username: "fred" });
    const list = createProject(db, fred, { name: "Home" }, "web");
    const item = addItem(db, fred, { projectId: list.id, title: "Fix tap" }, "web");
    completeItem(db, fred, item.id, "web");
    updateItem(db, fred, item.id, { title: "Fix the tap" }, "web");
    // Rows written in the same millisecond have no set order.
    const history = () =>
      listAudit(db, fred, { projectId: list.id })
        .filter((e) => e.entityId === item.id)
        .map((e) => e.detail)
        .sort();
    expect(history()).toEqual([
      'added task "Fix the tap"',
      'completed "Fix the tap"',
      'updated Fix tap: renamed to "Fix the tap"',
    ]);
    // A rename keeps the name it had, so its row still says what changed.
    const rename = listAudit(db, fred, { projectId: list.id }).find((e) => e.action === "update");
    expect(rename?.parts?.filter((p) => p.em).map((p) => p.text)).toEqual(["Fix tap"]);
    deleteItem(db, fred, item.id, "web");
    // Gone, so each row reads with the name it had then.
    expect(history()).toEqual([
      'added task "Fix tap"',
      'completed "Fix tap"',
      'deleted "Fix the tap"',
      'updated Fix tap: renamed to "Fix the tap"',
    ]);
  });

  it("names a deleted assignee as they were, and a moved item as it was here", () => {
    const { db } = createTestDb();
    const fred = createTestUser(db, { username: "fred" });
    const alice = createTestUser(db, { username: "alice" });
    const home = createProject(db, fred, { name: "Home" }, "web");
    const other = createProject(db, fred, { name: "Work" }, "web");
    inviteMember(db, fred, home.id, "alice", "web");
    acceptInvite(db, alice, home.id, "web");
    const item = addItem(db, fred, { projectId: home.id, title: "Fix tap" }, "web");
    updateItem(db, fred, item.id, { assigneeIds: [alice] }, "web");
    db.delete(authSchema.users).where(eq(authSchema.users.id, alice)).run();
    // Moved, then renamed for the new list's readers; Home's history keeps
    // the name Home knew.
    db.update(appSchema.items).set({ projectId: other.id }).where(eq(appSchema.items.id, item.id)).run();
    db.update(appSchema.items).set({ title: "Secret" }).where(eq(appSchema.items.id, item.id)).run();
    const history = listAudit(db, fred, { projectId: home.id })
      .filter((e) => e.entityId === item.id)
      .map((e) => e.detail)
      .sort();
    expect(history).toEqual(['added task "Fix tap"', 'updated Fix tap: assigned @alice']);
  });
});

describe("space events", () => {
  it("shows a space by its current name to people in it, and as it was to people who left", () => {
    const { db } = createTestDb();
    const fred = createTestUser(db, { username: "fred" });
    const alice = createTestUser(db, { username: "alice" });
    const home = createSpace(db, fred, { name: "Home" }, "web").id;
    inviteSpaceMember(db, fred, home, "alice", "web");
    acceptSpaceInvite(db, alice, home, "web");
    removeSpaceMember(db, alice, home, alice, "web");
    updateSpace(db, fred, home, { name: "Secret" }, "web");
    const spaceRows = (user: string) =>
      listAudit(db, user)
        .filter((e) => e.entityType.startsWith("space"))
        .map((e) => e.detail)
        .sort();
    expect(spaceRows(alice)).toEqual([
      'accepted invite to space "Home"',
      'left space "Home"',
    ]);
    expect(spaceRows(fred)).toEqual([
      'created space "Secret"',
      'invited @alice to space "Secret"',
      'updated space "Home": renamed to "Secret"',
    ]);
  });
});

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
    expect(passwordLog(userId)).toEqual([["update", "changed password", userId, userId, "web"]]);

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
      expect.arrayContaining(["changed password", "reset password with an emailed link"]),
    );
    expect(passwordLog(userId).filter((r) => r[1] === "reset password with an emailed link")).toHaveLength(1);
    expect(passwordLog(other)).toEqual([["update", "changed password", other, other, "web"]]);
  });
});
