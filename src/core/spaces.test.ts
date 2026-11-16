import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listAllAgentSessions, startWork } from "./agentSessions";
import { users } from "./auth-schema";
import { listAudit } from "./audit";
import { addItem, getItem, updateItem } from "./items";
import {
  acceptInvite,
  inviteMember,
  listAssignees,
  listSuggestedCollaborators,
} from "./members";
import {
  createProject,
  getProject,
  listProjects,
  reorderProject,
  updateProject,
} from "./projects";
import {
  acceptSpaceInvite,
  createSpace,
  declineSpaceInvite,
  deleteSpace,
  inviteSpaceMember,
  listPendingSpaceInvites,
  listSpaceMembers,
  listSpaces,
  listSuggestedSpaceMembers,
  listTrays,
  PERSONAL_TRAY,
  removeSpaceMember,
  reorderSpace,
  setProjectSpace,
  setSpaceMemberRole,
  updateSpace,
} from "./spaces";
import { spaceMembers, spaces } from "./schema";
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

  const putInSpace = (owner: string, listId: string) =>
    setProjectSpace(db, owner, listId, spaceId, "web");
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

  it("lets only the list's owner or its Space's admins set its repository", () => {
    join(alice, "alice");
    join(bob, "bob");
    const list = createProject(db, alice, { name: "Code" }, "web");
    putInSpace(alice, list.id);
    const setRepo = (userId: string, repository: string) =>
      updateProject(db, userId, list.id, { repository }, "web").repository;

    // bob is a plain member: he can edit the list, but not where agents work.
    expect(() => setRepo(bob, "bob/evil")).toThrow(/only the list's admin/);
    expect(updateProject(db, bob, list.id, { summary: "Ours" }, "web").summary).toBe("Ours");
    expect(getProject(db, alice, list.id)?.repository).toBeNull();
    // alice owns it; fred administers its Space without owning it.
    expect(setRepo(alice, "alice/code")).toBe("alice/code");
    expect(setRepo(fred, "fred/code")).toBe("fred/code");
    setSpaceMemberRole(db, fred, spaceId, bob, "admin", "web");
    expect(setRepo(bob, "bob/code")).toBe("bob/code");
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
    putInSpace(fred, groceries.id);

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
    putInSpace(fred, groceries.id);
    putInSpace(alice, hers.id);
    putInSpace(fred, direct.id);
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
    putInSpace(fred, groceries.id);
    putInSpace(alice, hers.id);
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
    putInSpace(fred, a.id);
    putInSpace(fred, b.id);
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

  it("orders each member's own trays, Personal among them, with spaces they create or join last", () => {
    const work = createSpace(db, fred, { name: "Work" }, "web").id;
    // Bob's Space is older than Work, but Fred joins it after: it goes last.
    const old = createSpace(db, bob, { name: "Old" }, "web").id;
    db.update(spaces).set({ createdAt: 0 }).where(eq(spaces.id, old)).run();
    inviteSpaceMember(db, bob, old, "fred", "web");
    acceptSpaceInvite(db, fred, old, "web");
    join(alice, "alice");
    expect(listTrays(db, fred)).toEqual([PERSONAL_TRAY, spaceId, work, old]);
    const alicesBefore = listTrays(db, alice);

    reorderSpace(db, fred, PERSONAL_TRAY, `after:${work}`, agent("k1"));
    expect(listTrays(db, fred)).toEqual([spaceId, work, PERSONAL_TRAY, old]);
    // A space moves anchored on Personal, and listSpaces keeps their order.
    reorderSpace(db, fred, spaceId, `after:${PERSONAL_TRAY}`, "web");
    expect(listTrays(db, fred)).toEqual([work, PERSONAL_TRAY, spaceId, old]);
    expect(listSpaces(db, fred).map((s) => s.id)).toEqual([work, spaceId, old]);
    reorderSpace(db, fred, PERSONAL_TRAY, "end", "web");
    expect(listTrays(db, fred)).toEqual([work, spaceId, old, PERSONAL_TRAY]);
    expect(listTrays(db, alice)).toEqual(alicesBefore);
    // Sorted: rows written in the same millisecond have no set order.
    expect(
      listAudit(db, fred)
        .filter((e) => e.action === "reorder")
        .map((e) => [e.source, e.entityType, e.entityId, e.detail].join(" "))
        .sort(),
    ).toEqual(
      [
        `mcp space ${PERSONAL_TRAY} reordered Personal`,
        `web space ${PERSONAL_TRAY} reordered Personal`,
        `web space ${spaceId} reordered space "Home"`,
      ].sort(),
    );

    // Joining another after that still puts it last, after Personal.
    const later = createSpace(db, bob, { name: "Later" }, "web").id;
    inviteSpaceMember(db, bob, later, "fred", "web");
    acceptSpaceInvite(db, fred, later, "web");
    expect(listTrays(db, fred).at(-1)).toBe(later);

    expect(() => reorderSpace(db, alice, work, "start", "web")).toThrow(/space not found/);
  });

  it("places trays from before they could move where they show, on the first move", () => {
    createSpace(db, fred, { name: "Work" }, "web");
    createSpace(db, fred, { name: "Play" }, "web");
    db.update(spaceMembers).set({ position: null }).run();
    db.update(users).set({ personalTrayPosition: null }).run();
    const [personal, a, b, c] = listTrays(db, fred);
    expect(personal).toBe(PERSONAL_TRAY);

    // Anchored on a space that has no position yet.
    reorderSpace(db, fred, c, `before:${a}`, "web");
    expect(listTrays(db, fred)).toEqual([PERSONAL_TRAY, c, a, b]);
  });

  it("suggests space members for the owner's other lists, but not ones they can already see", () => {
    join(alice, "alice");
    const inSpace = createProject(db, fred, { name: "In" }, "web");
    const outside = createProject(db, fred, { name: "Out" }, "web");
    putInSpace(fred, inSpace.id);
    const handles = (listId: string) =>
      listSuggestedCollaborators(db, fred, listId).map((c) => c.username);
    expect(handles(outside.id)).toEqual(["alice"]);
    expect(handles(inSpace.id)).toEqual([]);
  });

  it("suggests an admin's collaborators who aren't in the space yet", () => {
    // Fred shares a list with Bob, and is in another Space with Carol.
    const list = createProject(db, fred, { name: "Shared" }, "web");
    inviteMember(db, fred, list.id, "bob", "web");
    acceptInvite(db, bob, list.id, "web");
    const carol = createTestUser(db, { username: "carol" });
    const work = createSpace(db, carol, { name: "Work" }, "web").id;
    inviteSpaceMember(db, carol, work, "fred", "web");
    acceptSpaceInvite(db, fred, work, "web");
    const handles = () => listSuggestedSpaceMembers(db, fred, spaceId).map((c) => c.username);

    expect(handles()).toEqual(["bob", "carol"]);
    // Invited, pending or not, drops out; Alice was never a collaborator.
    inviteSpaceMember(db, fred, spaceId, "bob", "web");
    expect(handles()).toEqual(["carol"]);
    // Only admins invite, so members get no suggestions.
    acceptSpaceInvite(db, bob, spaceId, "web");
    expect(listSuggestedSpaceMembers(db, bob, spaceId)).toEqual([]);
  });

  describe("lists in a space", () => {
    it("lets a list's owner move it in, and a member only their own lists", () => {
      join(alice, "alice");
      const fredsList = createProject(db, fred, { name: "Fred's" }, "web");
      const hers = createProject(db, alice, { name: "Hers" }, "web");
      expect(() => setProjectSpace(db, alice, fredsList.id, spaceId, "web")).toThrow(
        /not found/,
      );
      setProjectSpace(db, alice, hers.id, spaceId, "web");
      expect(getProject(db, fred, hers.id)?.spaceId).toBe(spaceId);
      // Not into a Space you haven't joined.
      const other = createSpace(db, bob, { name: "Bob's" }, "web").id;
      expect(() => setProjectSpace(db, alice, hers.id, other, "web")).toThrow(
        /space not found/,
      );
      expect(
        listAudit(db, fred, { projectId: hers.id }).map((e) => e.detail),
      ).toContain('moved "Hers" into space "Home"');
    });

    it("lets the owner or a space admin take a list out, but not another member", () => {
      join(alice, "alice");
      join(bob, "bob");
      const hers = createProject(db, alice, { name: "Hers" }, "web");
      putInSpace(alice, hers.id);
      const job = addItem(db, alice, { projectId: hers.id, title: "Job" }, "web");
      updateItem(db, alice, job.id, { assigneeIds: [bob] }, "web");

      // Bob is a member, not an admin, and doesn't own it.
      expect(() => setProjectSpace(db, bob, hers.id, null, "web")).toThrow(
        /owner or a space admin/,
      );
      // Fred is an admin: he can take it out, but not move it elsewhere.
      const elsewhere = createSpace(db, fred, { name: "Work" }, "web").id;
      expect(() => setProjectSpace(db, fred, hers.id, elsewhere, "web")).toThrow(
        /only the list owner/,
      );
      setProjectSpace(db, fred, hers.id, null, "web");

      // It's Alice's own list again; Fred and Bob lose it, and Bob its item.
      expect(names(listProjects(db, alice))).toEqual(["Hers"]);
      expect(getProject(db, fred, hers.id)).toBeUndefined();
      expect(getProject(db, bob, hers.id)).toBeUndefined();
      expect(getItem(db, alice, job.id)?.assigneeIds).toEqual([]);
      expect(listAudit(db, alice, { projectId: hers.id }).map((e) => e.detail)).toContain(
        'took "Hers" out of space "Home", unassigned from 1 item',
      );
    });

    it("moves a list between spaces, so only the new space's people reach it", () => {
      join(alice, "alice");
      const work = createSpace(db, fred, { name: "Work" }, "web").id;
      inviteSpaceMember(db, fred, work, "bob", "web");
      acceptSpaceInvite(db, bob, work, "web");
      const list = createProject(db, fred, { name: "Shared" }, "web");
      putInSpace(fred, list.id);
      setProjectSpace(db, fred, list.id, work, "web");
      expect(getProject(db, alice, list.id)).toBeUndefined();
      expect(getProject(db, bob, list.id)?.name).toBe("Shared");
    });

    it("creates a list straight into a space its creator has joined", () => {
      join(alice, "alice");
      const list = createProject(db, alice, { name: "Groceries", spaceId }, "web");
      expect(getProject(db, fred, list.id)?.spaceId).toBe(spaceId);
      expect(() =>
        createProject(db, bob, { name: "Nope", spaceId }, "web"),
      ).toThrow(/space not found/);
      expect(listProjects(db, bob)).toEqual([]);
    });
  });
});
