import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listAllAgentSessions, startWork } from "./agentSessions";
import { listAudit } from "./audit";
import { addItem, getItem, updateItem } from "./items";
import {
  acceptInvite,
  inviteMember,
  listAssignees,
  listSuggestedCollaborators,
} from "./members";
import { createProject, getProject, listProjects, reorderProject } from "./projects";
import { projects } from "./schema";
import {
  acceptSpaceInvite,
  createSpace,
  declineSpaceInvite,
  deleteSpace,
  inviteSpaceMember,
  listPendingSpaceInvites,
  listSpaceMembers,
  listSpaces,
  removeSpaceMember,
  setSpaceMemberRole,
  updateSpace,
} from "./spaces";
import { createTestDb, createTestUser } from "./test-helpers";

type Db = ReturnType<typeof createTestDb>["db"];

const agent = (keyId: string) => ({
  source: "mcp" as const,
  agent: { keyId, name: keyId },
});

describe("spaces", () => {
  let db: Db;
  let fred: string;
  let alice: string;
  let bob: string;
  let spaceId: string;

  // Moving lists into a Space isn't core API yet (SDT-26), so tests set it.
  const putInSpace = (listId: string, id: string | null = spaceId) =>
    db.update(projects).set({ spaceId: id }).where(eq(projects.id, listId)).run();
  const join = (userId: string, handle: string) => {
    inviteSpaceMember(db, fred, spaceId, handle, "web");
    acceptSpaceInvite(db, userId, spaceId, "web");
  };
  const names = (rows: { name: string }[]) => rows.map((r) => r.name);

  beforeEach(() => {
    db = createTestDb().db;
    fred = createTestUser(db, { username: "fred" });
    alice = createTestUser(db, { username: "alice" });
    bob = createTestUser(db, { username: "bob" });
    spaceId = createSpace(db, fred, { name: "Home" }, "web").id;
  });

  it("makes the creator its only admin, and audits it", () => {
    expect(listSpaces(db, fred).map((s) => [s.name, s.role])).toEqual([["Home", "admin"]]);
    expect(listSpaceMembers(db, fred, spaceId).map((m) => [m.userId, m.role])).toEqual([
      [fred, "admin"],
    ]);
    // A stranger can't see it.
    expect(listSpaces(db, alice)).toEqual([]);
    expect(listSpaceMembers(db, alice, spaceId)).toEqual([]);
    expect(
      listAudit(db, fred).some(
        (e) => e.entityType === "space" && e.detail === 'created space "Home"',
      ),
    ).toBe(true);
  });

  it("shares every list in it once an invite is accepted, and only then", () => {
    const groceries = createProject(db, fred, { name: "Groceries" }, "web");
    const outside = createProject(db, fred, { name: "Outside" }, "web");
    putInSpace(groceries.id);

    inviteSpaceMember(db, fred, spaceId, "alice", "web");
    expect(listPendingSpaceInvites(db, alice).map((i) => i.spaceName)).toEqual(["Home"]);
    expect(getProject(db, alice, groceries.id)).toBeUndefined();

    acceptSpaceInvite(db, alice, spaceId, "web");
    expect(listPendingSpaceInvites(db, alice)).toEqual([]);
    expect(names(listProjects(db, alice))).toEqual(["Groceries"]);
    expect(getProject(db, alice, outside.id)).toBeUndefined();
    // She can work on it and be assigned its items, as a member, not an admin.
    const item = addItem(db, alice, { projectId: groceries.id, title: "Milk" }, "web");
    updateItem(db, fred, item.id, { assigneeIds: [alice] }, "web");
    expect(listAssignees(db, fred, groceries.id).map((a) => a.userId)).toEqual([fred, alice]);
    expect(listSpaces(db, alice)[0].role).toBe("member");

    // Declining leaves no access either.
    inviteSpaceMember(db, fred, spaceId, "bob", "web");
    declineSpaceInvite(db, bob, spaceId, "web");
    expect(getProject(db, bob, groceries.id)).toBeUndefined();
    // Sorted: both rows can share a millisecond, which leaves their order open.
    expect(listSpaceMembers(db, fred, spaceId).map((m) => m.userId).sort()).toEqual(
      [fred, alice].sort(),
    );
  });

  it("lets only admins manage the space, and keeps an admin", () => {
    join(alice, "alice");
    const memberOnly = /only a space admin/;
    expect(() => inviteSpaceMember(db, alice, spaceId, "bob", "web")).toThrow(memberOnly);
    expect(() => updateSpace(db, alice, spaceId, { name: "X" }, "web")).toThrow(memberOnly);
    expect(() => setSpaceMemberRole(db, alice, spaceId, alice, "admin", "web")).toThrow(
      memberOnly,
    );
    expect(() => removeSpaceMember(db, alice, spaceId, fred, "web")).toThrow(memberOnly);
    expect(() => deleteSpace(db, alice, spaceId, "web")).toThrow(memberOnly);
    // A stranger gets not-found, not a hint that the Space exists.
    expect(() => inviteSpaceMember(db, bob, spaceId, "alice", "web")).toThrow(
      /space not found/,
    );

    // The last admin can't leave or step down...
    expect(() => removeSpaceMember(db, fred, spaceId, fred, "web")).toThrow(/last admin/);
    expect(() => setSpaceMemberRole(db, fred, spaceId, fred, "member", "web")).toThrow(
      /needs an admin/,
    );
    // ...and only people who've joined can be made admin.
    inviteSpaceMember(db, fred, spaceId, "bob", "web");
    expect(() => setSpaceMemberRole(db, fred, spaceId, bob, "admin", "web")).toThrow(
      /joined/,
    );

    // Once Alice is an admin too, all admins are equal: she can demote Fred,
    // and he can then leave.
    setSpaceMemberRole(db, fred, spaceId, alice, "admin", "web");
    setSpaceMemberRole(db, alice, spaceId, fred, "member", "web");
    updateSpace(db, alice, spaceId, { name: "Flat" }, "web");
    removeSpaceMember(db, fred, spaceId, fred, "web");
    expect(listSpaces(db, fred)).toEqual([]);
    expect(listSpaces(db, alice).map((s) => [s.name, s.role])).toEqual([["Flat", "admin"]]);
    expect(
      listAudit(db, alice)
        .filter((e) => e.entityType === "space_member" && e.action === "update")
        .map((e) => e.detail),
    ).toContain('made @fred a member of space "Home"');
  });

  it("cleans up after someone is removed, unless they still have access another way", () => {
    join(alice, "alice");
    join(bob, "bob");
    const groceries = createProject(db, fred, { name: "Groceries" }, "web");
    const hers = createProject(db, alice, { name: "Hers" }, "web");
    const direct = createProject(db, fred, { name: "Direct" }, "web");
    for (const id of [groceries.id, hers.id, direct.id]) putInSpace(id);
    // Alice is also a direct member of one list.
    inviteMember(db, fred, direct.id, "alice", "web");
    acceptInvite(db, alice, direct.id, "web");

    const milk = addItem(db, fred, { projectId: groceries.id, title: "Milk" }, "web");
    const keep = addItem(db, fred, { projectId: direct.id, title: "Keep" }, "web");
    updateItem(db, fred, milk.id, { assigneeIds: [alice, bob] }, "web");
    updateItem(db, fred, keep.id, { assigneeIds: [alice] }, "web");
    startWork(db, alice, milk.id, {}, agent("alice-key"));
    startWork(db, alice, keep.id, {}, agent("alice-key"));

    removeSpaceMember(db, fred, spaceId, alice, "web");

    // She keeps her own list (still in the Space) and the direct one.
    expect(names(listProjects(db, alice)).sort()).toEqual(["Direct", "Hers"]);
    expect(getProject(db, fred, hers.id)?.spaceId).toBe(spaceId);
    expect(getItem(db, fred, milk.id)?.assigneeIds).toEqual([bob]);
    expect(getItem(db, fred, keep.id)?.assigneeIds).toEqual([alice]);
    expect(
      listAllAgentSessions(db, fred)
        .filter((s) => s.finishedAt === null)
        .map((s) => s.itemId),
    ).toEqual([keep.id]);
    expect(
      listAudit(db, fred).find(
        (e) => e.entityType === "space_member" && e.action === "delete",
      )?.detail,
    ).toBe('removed @alice from space "Home", unassigned from 1 item, ended 1 agent session');
  });

  it("returns lists to their owners when the space is deleted", () => {
    join(alice, "alice");
    const groceries = createProject(db, fred, { name: "Groceries" }, "web");
    const hers = createProject(db, alice, { name: "Hers" }, "web");
    putInSpace(groceries.id);
    putInSpace(hers.id);
    const milk = addItem(db, fred, { projectId: groceries.id, title: "Milk" }, "web");
    updateItem(db, fred, milk.id, { assigneeIds: [alice] }, "web");

    deleteSpace(db, fred, spaceId, "web");
    expect(listSpaces(db, fred)).toEqual([]);
    expect(names(listProjects(db, fred))).toEqual(["Groceries"]);
    expect(names(listProjects(db, alice))).toEqual(["Hers"]);
    expect(getProject(db, fred, groceries.id)?.spaceId).toBeNull();
    expect(getItem(db, fred, milk.id)?.assigneeIds).toEqual([]);
  });

  it("puts space lists at the end of a board until they're moved", () => {
    const a = createProject(db, fred, { name: "A" }, "web");
    const b = createProject(db, fred, { name: "B" }, "web");
    putInSpace(a.id);
    putInSpace(b.id);
    join(alice, "alice");
    createProject(db, alice, { name: "Mine" }, "web");
    const [first, second] = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(names(listProjects(db, alice))).toEqual(["Mine", first.name, second.name]);

    // Moving one list anchored on another she has no slot for yet works.
    reorderProject(db, alice, second.id, `before:${first.id}`, "web");
    expect(names(listProjects(db, alice))).toEqual(["Mine", second.name, first.name]);
    reorderProject(db, alice, first.id, "start", "web");
    expect(names(listProjects(db, alice))).toEqual([first.name, "Mine", second.name]);
    // Fred's board is untouched.
    expect(names(listProjects(db, fred))).toEqual(["A", "B"]);
  });

  it("suggests space members for the owner's other lists, but not ones they can already see", () => {
    join(alice, "alice");
    const inSpace = createProject(db, fred, { name: "In" }, "web");
    const outside = createProject(db, fred, { name: "Out" }, "web");
    putInSpace(inSpace.id);
    const handles = (listId: string) =>
      listSuggestedCollaborators(db, fred, listId).map((c) => c.username);
    expect(handles(outside.id)).toEqual(["alice"]);
    expect(handles(inSpace.id)).toEqual([]);
  });
});
