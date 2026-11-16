import { beforeEach, describe, expect, it } from "vitest";
import { listAllAgentSessions, startWork } from "./agentSessions";
import { listAudit } from "./audit";
import { addItem, getItem, updateItem } from "./items";
import {
  acceptInvite,
  declineInvite,
  inviteMember,
  listMembers,
  listPendingInvites,
  listSuggestedCollaborators,
  removeMember,
} from "./members";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  reorderProject,
  updateProject,
} from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";

type Db = ReturnType<typeof createTestDb>["db"];

describe("project membership", () => {
  let db: Db;
  let owner: string;
  let alice: string;
  let bob: string;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb().db;
    owner = createTestUser(db, { username: "owner", email: "owner@test.local" });
    alice = createTestUser(db, { username: "alice", email: "alice@test.local" });
    bob = createTestUser(db, { username: "bob", email: "bob@test.local" });
    projectId = createProject(db, owner, { name: "Shared" }, "web").id;
  });

  describe("inviteMember", () => {
    it("invites by username, by @handle, and by email", () => {
      expect(inviteMember(db, owner, projectId, "alice", "web").status).toBe(
        "pending",
      );
      // Re-inviting the same user is rejected regardless of handle form.
      expect(() => inviteMember(db, owner, projectId, "@alice", "web")).toThrow(
        /already pending/,
      );

      const byEmail = inviteMember(db, owner, projectId, "BOB@test.local", "web");
      expect(byEmail.userId).toBe(bob);
    });

    it("a pending invite grants no access until accepted", () => {
      inviteMember(db, owner, projectId, "alice", "web");
      expect(getProject(db, alice, projectId)).toBeUndefined();
      expect(listProjects(db, alice)).toHaveLength(0);
    });

    it("rejects a non-owner, a missing account, and the owner themselves", () => {
      // A member (has access, not owner) is told only the owner may invite...
      inviteMember(db, owner, projectId, "alice", "web");
      acceptInvite(db, alice, projectId, "web");
      expect(() => inviteMember(db, alice, projectId, "bob", "web")).toThrow(
        /only the list owner/,
      );
      // ...while a stranger with no access gets a plain not-found (no leak).
      expect(() => inviteMember(db, bob, projectId, "alice", "web")).toThrow(
        /list not found/,
      );
      expect(() => inviteMember(db, owner, projectId, "nobody", "web")).toThrow(
        /no account found/,
      );
      expect(() => inviteMember(db, owner, projectId, "owner", "web")).toThrow(
        /owner already has access/,
      );
    });

    it("records an audit row for the invite", () => {
      inviteMember(db, owner, projectId, "alice", "web");
      const entry = listAudit(db, owner, { projectId }).find(
        (e) => e.entityType === "member",
      );
      expect(entry?.action).toBe("create");
      expect(entry?.detail).toContain("@alice");
    });
  });

  describe("acceptInvite / declineInvite", () => {
    beforeEach(() => inviteMember(db, owner, projectId, "alice", "web"));

    it("accepting grants access and shows the project in the member's list", () => {
      acceptInvite(db, alice, projectId, "web");
      expect(getProject(db, alice, projectId)?.id).toBe(projectId);
      expect(listProjects(db, alice).map((p) => p.id)).toContain(projectId);
    });

    it("declining removes the invite and grants nothing", () => {
      declineInvite(db, alice, projectId, "web");
      expect(getProject(db, alice, projectId)).toBeUndefined();
      expect(listPendingInvites(db, alice)).toHaveLength(0);
      // Declining again has nothing to act on.
      expect(() => declineInvite(db, alice, projectId, "web")).toThrow(
        /no pending invite/,
      );
    });

    it("only the invited user can accept", () => {
      expect(() => acceptInvite(db, bob, projectId, "web")).toThrow(
        /no pending invite/,
      );
    });
  });

  describe("removeMember", () => {
    beforeEach(() => {
      inviteMember(db, owner, projectId, "alice", "web");
      acceptInvite(db, alice, projectId, "web");
    });

    it("the owner can remove an accepted member", () => {
      removeMember(db, owner, projectId, alice, "web");
      expect(getProject(db, alice, projectId)).toBeUndefined();
    });

    it("a member can remove themselves (leave)", () => {
      removeMember(db, alice, projectId, alice, "web");
      expect(getProject(db, alice, projectId)).toBeUndefined();
      const entry = listAudit(db, owner, { projectId }).find(
        (e) => e.entityType === "member" && e.action === "delete",
      );
      expect(entry?.detail).toContain("left");
    });

    it("a member cannot remove another member", () => {
      inviteMember(db, owner, projectId, "bob", "web");
      acceptInvite(db, bob, projectId, "web");
      expect(() => removeMember(db, alice, projectId, bob, "web")).toThrow(
        /only the list owner/,
      );
    });

    it("removing a non-member is a no-op", () => {
      expect(() =>
        removeMember(db, owner, projectId, bob, "web"),
      ).not.toThrow();
    });

    it("takes a removed member off their items, keeping joint items' other assignees", () => {
      const add = (pid: string, title: string, assigneeIds: string[]) => {
        const it = addItem(db, owner, { projectId: pid, title }, "web");
        return updateItem(db, owner, it.id, { assigneeIds }, "web").id;
      };
      const joint = add(projectId, "joint", [owner, alice]);
      const hers = add(projectId, "hers", [alice]);
      const mine = add(projectId, "mine", [owner]);
      // Her assignment on another of the owner's lists she stays on is kept.
      const other = createProject(db, owner, { name: "Other" }, "web").id;
      inviteMember(db, owner, other, "alice", "web");
      acceptInvite(db, alice, other, "web");
      const elsewhere = add(other, "elsewhere", [alice]);

      removeMember(db, owner, projectId, alice, "web");
      const assigneesOf = (id: string) => getItem(db, owner, id)?.assigneeIds;
      expect(assigneesOf(joint)).toEqual([owner]);
      expect(assigneesOf(hers)).toEqual([]);
      expect(assigneesOf(mine)).toEqual([owner]);
      expect(assigneesOf(elsewhere)).toEqual([alice]);
      // One audit row for the removal, in the same transaction, saying how many.
      const entry = listAudit(db, owner).find(
        (e) => e.entityType === "member" && e.action === "delete",
      );
      expect(entry?.detail).toBe("removed @alice, unassigned from 2 items");
    });

    it("ends a removed member's agent sessions on the list, and only theirs", () => {
      const agent = (keyId: string) => ({
        source: "mcp" as const,
        agent: { keyId, name: keyId },
      });
      const item = addItem(db, owner, { projectId, title: "t" }, "web");
      startWork(db, alice, item.id, {}, agent("alice-key"));
      startWork(db, owner, item.id, {}, agent("owner-key"));
      // Her session on another list she stays on carries on.
      const other = createProject(db, owner, { name: "Other" }, "web").id;
      inviteMember(db, owner, other, "alice", "web");
      acceptInvite(db, alice, other, "web");
      const elsewhere = addItem(db, owner, { projectId: other, title: "e" }, "web");
      startWork(db, alice, elsewhere.id, {}, agent("alice-key"));

      removeMember(db, owner, projectId, alice, "web");
      const open = listAllAgentSessions(db, owner)
        .filter((s) => s.finishedAt === null)
        .map((s) => `${s.agentKeyId} on ${s.itemId}`);
      expect(open.sort()).toEqual(
        [`owner-key on ${item.id}`, `alice-key on ${elsewhere.id}`].sort(),
      );
      const entry = listAudit(db, owner).find(
        (e) => e.entityType === "member" && e.action === "delete",
      );
      expect(entry?.detail).toBe(
        "removed @alice, unassigned from 1 item, ended 1 agent session",
      );
    });

    it("unassigns a member's items when they leave", () => {
      const item = addItem(
        db,
        owner,
        { projectId, title: "t" },
        "web",
      );
      updateItem(db, owner, item.id, { assigneeIds: [alice] }, "web");
      removeMember(db, alice, projectId, alice, "web");
      expect(getItem(db, owner, item.id)?.assigneeIds).toEqual([]);
    });
  });

  describe("listMembers / listPendingInvites", () => {
    it("lists members with their status; excludes the owner", () => {
      inviteMember(db, owner, projectId, "alice", "web");
      inviteMember(db, owner, projectId, "bob", "web");
      acceptInvite(db, alice, projectId, "web");

      const members = listMembers(db, owner, projectId);
      expect(members.map((m) => m.username).sort()).toEqual(["alice", "bob"]);
      const aliceRow = members.find((m) => m.username === "alice");
      expect(aliceRow?.status).toBe("accepted");
      expect(members.find((m) => m.username === "bob")?.status).toBe("pending");
    });

    it("surfaces a pending invite to the invitee with project and owner", () => {
      inviteMember(db, owner, projectId, "alice", "web");
      const invites = listPendingInvites(db, alice);
      expect(invites).toHaveLength(1);
      expect(invites[0]).toMatchObject({
        projectId,
        projectName: "Shared",
        ownerName: "Test User",
      });
      // Once accepted it's no longer pending.
      acceptInvite(db, alice, projectId, "web");
      expect(listPendingInvites(db, alice)).toHaveLength(0);
    });
  });

  describe("listSuggestedCollaborators", () => {
    const names = (rows: { username: string | null }[]) =>
      rows.map((r) => r.username);

    it("suggests people from the owner's other lists, in either direction", () => {
      // owner's own list: alice accepted, bob only pending.
      inviteMember(db, owner, projectId, "alice", "web");
      acceptInvite(db, alice, projectId, "web");
      inviteMember(db, owner, projectId, "bob", "web");
      // carol's list, which owner and dave both accepted.
      const carol = createTestUser(db, { username: "carol" });
      const dave = createTestUser(db, { username: "dave" });
      createTestUser(db, { username: "stranger" });
      const hers = createProject(db, carol, { name: "Hers" }, "web").id;
      inviteMember(db, carol, hers, "owner", "web");
      acceptInvite(db, owner, hers, "web");
      inviteMember(db, carol, hers, "dave", "web");
      acceptInvite(db, dave, hers, "web");

      const home = createProject(db, owner, { name: "Home" }, "web").id;
      expect(names(listSuggestedCollaborators(db, owner, home))).toEqual([
        "alice",
        "carol",
        "dave",
      ]);

      // Anyone already on the list, pending or accepted, drops out.
      inviteMember(db, owner, home, "carol", "web");
      expect(names(listSuggestedCollaborators(db, owner, home))).toEqual([
        "alice",
        "dave",
      ]);
      expect(names(listSuggestedCollaborators(db, owner, projectId))).toEqual([
        "carol",
        "dave",
      ]);
      // Only the owner can invite, so a member gets no suggestions.
      expect(listSuggestedCollaborators(db, alice, projectId)).toEqual([]);
    });
  });

  describe("per-user ordering", () => {
    it("each user orders shared projects on their own board independently", () => {
      // owner board so far: [Shared]. Add two more.
      createProject(db, owner, { name: "A" }, "web");
      const b = createProject(db, owner, { name: "B" }, "web");
      // alice accepts B (appended to her empty board), then makes her own C.
      inviteMember(db, owner, b.id, "alice", "web");
      acceptInvite(db, alice, b.id, "web");
      const c = createProject(db, alice, { name: "C" }, "web");

      expect(listProjects(db, owner).map((p) => p.name)).toEqual([
        "Shared",
        "A",
        "B",
      ]);
      expect(listProjects(db, alice).map((p) => p.name)).toEqual(["B", "C"]);

      // Alice moves B after C on her board; the owner's board is untouched.
      reorderProject(db, alice, b.id, `after:${c.id}`, "web");
      expect(listProjects(db, alice).map((p) => p.name)).toEqual(["C", "B"]);
      expect(listProjects(db, owner).map((p) => p.name)).toEqual([
        "Shared",
        "A",
        "B",
      ]);
    });

    it("leaving or being removed drops only that user's ordering slot", () => {
      inviteMember(db, owner, projectId, "alice", "web");
      acceptInvite(db, alice, projectId, "web");
      expect(listProjects(db, alice).map((p) => p.name)).toEqual(["Shared"]);

      removeMember(db, owner, projectId, alice, "web");
      expect(listProjects(db, alice)).toHaveLength(0);
      expect(listProjects(db, owner).map((p) => p.name)).toEqual(["Shared"]);
    });
  });

  describe("member edit permissions", () => {
    beforeEach(() => {
      inviteMember(db, owner, projectId, "alice", "web");
      acceptInvite(db, alice, projectId, "web");
    });

    it("a member can edit name, status, and summary", () => {
      updateProject(
        db,
        alice,
        projectId,
        { name: "Renamed", status: "archived", summary: "by alice" },
        "web",
      );
      const p = getProject(db, owner, projectId);
      expect(p?.name).toBe("Renamed");
      expect(p?.status).toBe("archived");
      expect(p?.summary).toBe("by alice");
    });

    it("a member cannot change the prefix or delete — and writes no audit", () => {
      expect(() =>
        updateProject(db, alice, projectId, { prefix: "NEW" }, "web"),
      ).toThrow(/only the list owner/);
      expect(() => deleteProject(db, alice, projectId, "web")).toThrow(
        /only the list owner/,
      );

      // The project is untouched and no misleading prefix/delete audit landed.
      expect(getProject(db, owner, projectId)).toBeDefined();
      const actions = listAudit(db, owner, { projectId }).map((e) => e.action);
      expect(actions).not.toContain("delete");
      expect(
        listAudit(db, owner, { projectId }).some((e) =>
          e.detail.includes("prefix"),
        ),
      ).toBe(false);
    });
  });
});
