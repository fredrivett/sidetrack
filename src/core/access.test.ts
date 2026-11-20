import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import { addLabel, listLabels } from "./labels";
import { createTestDb, createTestUser } from "./test-helpers";
import { addItem, getItem, listItems } from "./items";
import {
  createProject,
  getProject,
  getProjectWithItems,
  listProjects,
} from "./projects";
import { type ListRole, projectMembers, projectPositions } from "./schema";
import { listAccess, listAccessById } from "./access";
import { addComment, mentionNotice } from "./comments";
import { completeItem, deleteItem, setItemsCollapsed, updateItem } from "./items";
import { acceptInvite, inviteMember, listAssignees, setMemberRole } from "./members";
import { linkItemToPr, listItemsForPr, setPrState } from "./prLinks";
import { updateProject } from "./projects";
import {
  acceptSpaceInvite,
  createSpace,
  inviteSpaceMember,
  setProjectSpace,
  setSpaceMemberRole,
} from "./spaces";

type Db = ReturnType<typeof createTestDb>["db"];

// Insert an *accepted* membership directly, exercising the hasProjectAccess
// seam without going through the invite/accept flow (covered in
// members.test.ts). Mirrors acceptInvite: an accepted member also needs a
// project_positions row, since listProjects orders by the viewer's own board.
// Pending rows grant no access, so accepted is the relevant state here.
function addMember(db: Db, projectId: string, userId: string) {
  db.insert(projectMembers)
    .values({ id: nanoid(12), projectId, userId, status: "accepted" })
    .run();
  db.insert(projectPositions)
    .values({ userId, projectId, position: "a0" })
    .run();
}

describe("project access (owner + members)", () => {
  let db: Db;
  let owner: string;
  let member: string;
  let stranger: string;

  beforeEach(() => {
    db = createTestDb().db;
    owner = createTestUser(db, { email: "owner@test.local" });
    member = createTestUser(db, { email: "member@test.local" });
    stranger = createTestUser(db, { email: "stranger@test.local" });
  });

  it("with no member rows, access is owner-only (the no-op baseline)", () => {
    const p = createProject(db, owner, { name: "Solo" }, "web");
    expect(getProject(db, owner, p.id)?.id).toBe(p.id);
    expect(getProject(db, member, p.id)).toBeUndefined();
    expect(listProjects(db, member)).toHaveLength(0);
  });

  it("a member can read the project and its items; a stranger cannot", () => {
    const p = createProject(db, owner, { name: "Shared" }, "web");
    addItem(db, owner, { projectId: p.id, title: "T1" }, "web");
    addMember(db, p.id, member);

    expect(getProject(db, member, p.id)?.id).toBe(p.id);
    expect(listProjects(db, member).map((x) => x.id)).toContain(p.id);
    expect(listItems(db, member, p.id).map((i) => i.title)).toEqual(["T1"]);
    expect(getProjectWithItems(db, member, p.id)?.items).toHaveLength(1);

    expect(getProject(db, stranger, p.id)).toBeUndefined();
    expect(listProjects(db, stranger)).toHaveLength(0);
    expect(listItems(db, stranger, p.id)).toHaveLength(0);
  });

  it("a member can edit: add items and labels", () => {
    const p = createProject(db, owner, { name: "Shared" }, "web");
    addMember(db, p.id, member);

    const item = addItem(
      db,
      member,
      { projectId: p.id, title: "By member" },
      "web",
    );
    expect(getItem(db, owner, item.id)?.title).toBe("By member");

    addLabel(db, member, p.id, { name: "infra" }, "web");
    expect(listLabels(db, owner, p.id).map((l) => l.name)).toContain(
      "infra",
    );
  });

  it("a member sees the project's audit history; a stranger does not", () => {
    const p = createProject(db, owner, { name: "Shared" }, "web");
    addMember(db, p.id, member);

    expect(listAudit(db, member, { projectId: p.id }).length).toBeGreaterThan(0);
    expect(listAudit(db, stranger, { projectId: p.id })).toHaveLength(0);

    // All-projects view picks up the shared project for the member.
    expect(
      listAudit(db, member).some((e) => e.projectId === p.id),
    ).toBe(true);
  });
});

describe("list roles: view, comment, edit", () => {
  function setup() {
    const { db } = createTestDb();
    const owner = createTestUser(db, { username: "lorna" });
    const jo = createTestUser(db, { username: "jo" });
    const list = createProject(db, owner, { name: "Life" }, "web");
    const item = addItem(db, owner, { projectId: list.id, title: "Swim" }, "web");
    return { db, owner, jo, list, item };
  }
  function join(db: Db, owner: string, jo: string, listId: string, role: ListRole) {
    inviteMember(db, owner, listId, "jo", "web", role);
    acceptInvite(db, jo, listId, "web");
  }
  const writes = (db: Db, jo: string, listId: string, itemId: string) => ({
    add: () => addItem(db, jo, { projectId: listId, title: "New" }, "web"),
    edit: () => updateItem(db, jo, itemId, { title: "Run" }, "web"),
    tick: () => completeItem(db, jo, itemId, "web"),
    remove: () => deleteItem(db, jo, itemId, "web"),
    label: () => addLabel(db, jo, listId, { name: "health" }, "web"),
    rename: () => updateProject(db, jo, listId, { name: "Mine" }, "web"),
  });

  it("a viewer sees the list and its items but changes nothing, comments included", () => {
    const { db, owner, jo, list, item } = setup();
    join(db, owner, jo, list.id, "viewer");
    expect(getItem(db, jo, item.id)?.title).toBe("Swim");
    expect(listAccess(db, jo, list.id)).toBe("view");
    for (const [what, write] of Object.entries(writes(db, jo, list.id, item.id))) {
      expect(write, what).toThrow("you can view this list but not change it");
    }
    expect(() => addComment(db, jo, item.id, "Go Lorna", "web")).toThrow(/view this list/);
    // Folding sub-items is how they look at it, so that's still theirs.
    setItemsCollapsed(db, jo, [item.id], true);
    expect(getItem(db, owner, item.id)?.collapsed).toBe(true);
    // Their own GitHub webhook doesn't change the list's PR badges.
    const pr = "https://github.com/o/r/pull/1";
    linkItemToPr(db, owner, item.id, pr, "web");
    setPrState(db, jo, pr, "merged");
    expect(listItemsForPr(db, owner, pr).map((l) => l.prState)).toEqual([null]);
    setPrState(db, owner, pr, "merged");
    expect(listItemsForPr(db, owner, pr).map((l) => l.prState)).toEqual(["merged"]);
    // Nothing changed, and nothing was logged as theirs.
    expect(getItem(db, owner, item.id)).toMatchObject({ title: "Swim", completedAt: null });
    expect(listAudit(db, owner, { projectId: list.id }).filter((r) => r.actor === jo)).toHaveLength(1);
  });

  it("a commenter comments but changes nothing else; an editor changes anything", () => {
    const { db, owner, jo, list, item } = setup();
    join(db, owner, jo, list.id, "commenter");
    expect(addComment(db, jo, item.id, "Go Lorna", "web").body).toBe("Go Lorna");
    // They're on the list, so mentioning them reaches them.
    const ask = addComment(db, owner, item.id, "@jo can you check?", "web");
    expect(mentionNotice(db, owner, ask)?.to.map((t) => t.userId)).toEqual([jo]);
    expect(() => completeItem(db, jo, item.id, "web")).toThrow(
      "you can comment on this list but not change it",
    );
    setMemberRole(db, owner, list.id, jo, "editor", "web");
    expect(completeItem(db, jo, item.id, "web").completedAt).not.toBeNull();
  });

  it("only those who can edit hold work: a viewer can't be assigned, and lowering a role unassigns", () => {
    const { db, owner, jo, list, item } = setup();
    join(db, owner, jo, list.id, "editor");
    updateItem(db, owner, item.id, { assigneeIds: [jo] }, "web");
    const canHold = () =>
      listAssignees(db, owner, list.id).map((a) => [a.userId, a.canEdit]);
    expect(canHold()).toEqual([[owner, true], [jo, true]]);

    setMemberRole(db, owner, list.id, jo, "viewer", "web");
    expect(getItem(db, owner, item.id)?.assigneeIds).toEqual([]);
    // Still on the list, to mention and to see, but not to assign.
    expect(canHold()).toEqual([[owner, true], [jo, false]]);
    expect(() => updateItem(db, owner, item.id, { assigneeIds: [jo] }, "web")).toThrow(
      /only view it/,
    );
    // Still on their board, as a viewer.
    expect(listProjects(db, jo).map((p) => p.id)).toEqual([list.id]);
    const [row] = listAudit(db, owner, { projectId: list.id }).filter((r) => r.event?.type === "member.role");
    expect(row?.event).toMatchObject({ role: "viewer", lost: { unassigned: 1 } });
    // The same role again is a no-op, with no second row.
    setMemberRole(db, owner, list.id, jo, "viewer", "web");
    expect(
      listAudit(db, owner, { projectId: list.id }).filter((r) => r.event?.type === "member.role"),
    ).toHaveLength(1);
    expect(() => setMemberRole(db, jo, list.id, jo, "editor", "web")).toThrow(/only the list owner/);
  });

  it("a Space role reaches every list in it, and the most generous route wins", () => {
    const { db, owner, jo, list, item } = setup();
    const space = createSpace(db, owner, { name: "Home" }, "web");
    setProjectSpace(db, owner, list.id, space.id, "web");
    inviteSpaceMember(db, owner, space.id, "jo", "web", "viewer");
    acceptSpaceInvite(db, jo, space.id, "web");
    expect(listAccessById(db, jo)).toEqual(new Map([[list.id, "view"]]));
    expect(() => completeItem(db, jo, item.id, "web")).toThrow(/view this list/);
    const joCanHold = () => listAssignees(db, owner, list.id).find((a) => a.userId === jo)?.canEdit;
    expect(joCanHold()).toBe(false);
    // A Space viewer doesn't add lists to it.
    const theirs = createProject(db, jo, { name: "Jo's" }, "web");
    expect(() => setProjectSpace(db, jo, theirs.id, space.id, "web")).toThrow(/admins and members/);
    expect(() => createProject(db, jo, { name: "In it", spaceId: space.id }, "web")).toThrow(
      /admins and members/,
    );

    // Edit on the list itself outranks view through the Space.
    join(db, owner, jo, list.id, "editor");
    expect(listAccess(db, jo, list.id)).toBe("edit");
    expect(joCanHold()).toBe(true);
    expect(completeItem(db, jo, item.id, "web").completedAt).not.toBeNull();
  });

  it("lowering a Space role takes them off its items, unless they can still edit another way", () => {
    const { db, owner, jo, list, item } = setup();
    const space = createSpace(db, owner, { name: "Home" }, "web");
    setProjectSpace(db, owner, list.id, space.id, "web");
    const other = createProject(db, owner, { name: "Work", spaceId: space.id }, "web");
    const report = addItem(db, owner, { projectId: other.id, title: "Report" }, "web");
    inviteSpaceMember(db, owner, space.id, "jo", "web");
    acceptSpaceInvite(db, jo, space.id, "web");
    join(db, owner, jo, list.id, "editor");
    updateItem(db, owner, item.id, { assigneeIds: [jo] }, "web");
    updateItem(db, owner, report.id, { assigneeIds: [jo] }, "web");

    setSpaceMemberRole(db, owner, space.id, jo, "commenter", "web");
    expect(getItem(db, owner, item.id)?.assigneeIds).toEqual([jo]);
    expect(getItem(db, owner, report.id)?.assigneeIds).toEqual([]);
    expect(listAccess(db, jo, other.id)).toBe("comment");
  });
});
