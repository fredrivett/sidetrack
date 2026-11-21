import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import { addLabel, listLabels, updateLabel } from "./labels";
import { createTestDb, createTestUser } from "./test-helpers";
import { addItem, getItem, listDoneBefore, listItems, listSubItems, setItemParent } from "./items";
import { countCommentsByItem, listComments, listMentionable, listRecentComments } from "./comments";
import { buildAgendaBrief } from "./agendaBrief";
import { resolveItemRef } from "./itemRef";
import { listLabelUsage } from "./labels";
import { listNotifications, setNotificationLevel } from "./notifications";
import { listAllPrLinks } from "./prLinks";
import { listNoDate, listToday, sampleOpenItemTitles } from "./projects";
import {
  createProject,
  getProject,
  getProjectWithItems,
  listProjects,
} from "./projects";
import { itemFollows, type ListRole, notifications, projectMembers, projectPositions } from "./schema";
import { limitedListsById, listAccess, listAccessById } from "./access";
import { addComment, mentionNotice } from "./comments";
import { plainText } from "./describe";
import { listFollowedItemIds } from "./follows";
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

describe("a membership shown only someone's items", () => {
  // Lorna's week: what's assigned to her (or has a line that is) shows
  // whole; everything else must never reach Jo, by any read.
  function setup() {
    const { db } = createTestDb();
    const lorna = createTestUser(db, { username: "lorna", name: "Lorna" });
    const fred = createTestUser(db, { username: "fred", name: "Fred" });
    const jo = createTestUser(db, { username: "jo", name: "Jo" });
    const vic = createTestUser(db, { username: "vic", name: "Vic" });
    const list = createProject(db, lorna, { name: "Week" }, "web");
    inviteMember(db, lorna, list.id, "fred", "web", "editor");
    acceptInvite(db, fred, list.id, "web");
    inviteMember(db, lorna, list.id, "vic", "web", "viewer");
    acceptInvite(db, vic, list.id, "web");
    inviteMember(db, lorna, list.id, "jo", "web", "commenter", { onlyMine: true });
    acceptInvite(db, jo, list.id, "web");
    for (const u of [jo, vic]) setNotificationLevel(db, u, "all", "all");

    const swim = addItem(db, lorna, { projectId: list.id, title: "Swim", assigneeIds: [lorna], subItems: ["Pack towel"] }, "web");
    const garden = addItem(db, lorna, { projectId: list.id, title: "Garden", subItems: ["Mow"] }, "web");
    const mow = listSubItems(db, lorna, garden.id)[0];
    updateItem(db, lorna, mow.id, { assigneeIds: [lorna] }, "web");
    const party = addItem(db, fred, { projectId: list.id, title: "SECRET party", labels: ["fun"], subItems: ["SECRET cake"], dueDate: "2026-11-21" }, "web");
    const cake = listSubItems(db, fred, party.id)[0];
    updateItem(db, fred, cake.id, { assigneeIds: [fred] }, "web");
    addComment(db, fred, party.id, "SECRET comment", "web");
    linkItemToPr(db, fred, party.id, "https://github.com/o/r/pull/1", "web");
    const errand = addItem(db, fred, { projectId: list.id, title: "SECRET errand", assigneeIds: [fred], dueDate: "2026-11-21" }, "web");
    completeItem(db, fred, errand.id, "web");
    const gone = addItem(db, fred, { projectId: list.id, title: "SECRET deleted" }, "web");
    deleteItem(db, fred, gone.id, "web");
    return { db, lorna, fred, jo, vic, list, swim, party, errand };
  }

  // Everything a person can read about the board, as one string.
  function everything(db: Db, u: string, listId: string, ids: string[]) {
    const now = Date.parse("2026-11-21T12:00:00Z");
    return JSON.stringify([
      listItems(db, u, listId, { includeCompleted: true }),
      listDoneBefore(db, u, { before: now + 1, limit: 50 }),
      listToday(db, u, { today: "2026-11-21" }),
      listNoDate(db, u, { today: "2026-11-21" }),
      sampleOpenItemTitles(db, u, 50),
      ids.map((id) => [getItem(db, u, id), listComments(db, u, id), listAudit(db, u, { itemId: id })]),
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => resolveItemRef(db, u, `${getProject(db, u, listId)?.prefix}-${n}`)),
      listRecentComments(db, u),
      listAudit(db, u, { projectId: listId }),
      listAudit(db, u),
      listLabelUsage(db, u, listId),
      listNotifications(db, u),
      listAllPrLinks(db, u),
      listItemsForPr(db, u, "https://github.com/o/r/pull/1"),
      buildAgendaBrief(db, u, { now, timeZone: "UTC", since: 0 }),
    ], (_, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));
  }

  it("shows Jo only Lorna's item groups, by every read", () => {
    const { db, fred, jo, vic, list, party, errand, swim } = setup();
    const ids = [party.id, errand.id, swim.id];
    // The control: someone shown the whole list reads all of it.
    for (const whole of [fred, vic]) expect(everything(db, whole, list.id, ids)).toContain("SECRET");
    const seen = everything(db, jo, list.id, ids);
    expect(seen).not.toContain("SECRET");
    // A label only on a hidden item would give it away.
    expect(listLabels(db, jo, list.id).map((l) => l.name)).toEqual([]);
    expect(listLabels(db, vic, list.id).map((l) => l.name)).toEqual(["fun"]);
    expect(countCommentsByItem(db, jo)).toEqual({});
    // Not just hidden when shown: nothing about them was written for her.
    const rows = db.select().from(notifications).where(eq(notifications.userId, jo)).all();
    expect(rows).toHaveLength(listNotifications(db, jo).length);
    expect(Object.keys(countCommentsByItem(db, vic))).toEqual([party.id]);
    expect(listItems(db, jo, list.id).map((i) => i.title).sort()).toEqual(["Garden", "Mow", "Pack towel", "Swim"]);
    expect([...limitedListsById(db, jo)]).toEqual([[list.id, "Lorna"]]);
    expect(limitedListsById(db, vic).size).toBe(0);
    // Nor can she act on what she can't see.
    expect(() => addComment(db, jo, party.id, "hi", "web")).toThrow(/not found/);
    expect(addComment(db, jo, swim.id, "Go Lorna", "web").body).toBe("Go Lorna");
  });

  it("keeps hidden labels and hidden items' names out of her activity", () => {
    const { db, lorna, fred, jo, list } = setup();
    const label = addLabel(db, fred, list.id, { name: "SECRET label" }, "web");
    updateLabel(db, fred, label.id, { name: "SECRET renamed" }, "web");
    // A sub-item she sees leaves a parent she doesn't, which is then renamed.
    const parent = addItem(db, fred, { projectId: list.id, title: "Parent", subItems: ["Lorna's bit"] }, "web");
    const bit = listSubItems(db, fred, parent.id)[0];
    updateItem(db, fred, bit.id, { assigneeIds: [lorna] }, "web");
    setItemParent(db, fred, bit.id, null, "web");
    updateItem(db, fred, parent.id, { title: "SECRET parent" }, "web");
    const feed = JSON.stringify([listAudit(db, jo, { projectId: list.id }), listAudit(db, jo), listAudit(db, jo, { itemId: bit.id })]);
    expect(feed).toContain("Lorna's bit");
    expect(feed).not.toContain("SECRET");
    // The control: an editor's feed names them.
    expect(JSON.stringify(listAudit(db, fred, { projectId: list.id }))).toContain("SECRET parent");
  });

  it("doesn't email or make Jo follow a hidden item she's mentioned on", () => {
    const { db, fred, jo, party, swim } = setup();
    const notice = (itemId: string) => mentionNotice(db, fred, addComment(db, fred, itemId, "@jo look", "web"));
    expect(notice(party.id)).toBeNull();
    expect(listFollowedItemIds(db, jo)).not.toContain(party.id);
    expect(db.select().from(itemFollows).where(eq(itemFollows.userId, jo)).all().map((f) => f.itemId)).not.toContain(party.id);
    // The control: on her own partner's item she's emailed.
    expect(notice(swim.id)?.to.map((t) => t.userId)).toEqual([jo]);
    // Nor is she offered to mention on it.
    expect(listMentionable(db, fred, party.id)).not.toContain(jo);
    expect(listMentionable(db, fred, swim.id)).toContain(jo);
  });

  it("says so when she's shown the whole list again", () => {
    const { db, lorna, jo, list, party } = setup();
    setMemberRole(db, lorna, list.id, jo, "commenter", "web", false);
    expect(getItem(db, jo, party.id)).toBeDefined();
    const said = listNotifications(db, jo).map((n) => plainText(n.parts));
    expect(said).toContain('Lorna made you a commenter of "Week", seeing all of it');
    expect(listAudit(db, lorna, { projectId: list.id }).map((e) => e.detail)).toContainEqual(
      expect.stringMatching(/commenter of .*Week.*, seeing all of it/),
    );
  });

  it("says whose items they see when they're invited and join", () => {
    const { db, lorna, fred, jo } = setup();
    const said = (u: string) => listNotifications(db, u).map((n) => plainText(n.parts));
    expect(said(fred)).toContain('Lorna invited @jo to "Week" as a commenter of @lorna\'s items');
    expect(said(jo)).toContain('Lorna invited you to "Week" as a commenter of @lorna\'s items');
    expect(said(lorna)).toContain('Jo joined "Week" as a commenter of your items');
  });

  it("follows assignment as it changes, and the most generous route in", () => {
    const { db, lorna, fred, jo, list, party, swim } = setup();
    addComment(db, fred, swim.id, "Nice one", "web");
    const told = () => JSON.stringify(listNotifications(db, jo));
    expect(told()).toContain("Swim");
    updateItem(db, lorna, swim.id, { assigneeIds: [] }, "web");
    expect(getItem(db, jo, swim.id)).toBeUndefined();
    // What she was told of it goes once she can't see it.
    expect(told()).not.toContain("Swim");
    updateItem(db, lorna, party.id, { assigneeIds: [lorna] }, "web");
    expect(listItems(db, jo, list.id).map((i) => i.title)).toContain("SECRET party");
    // A Space that shows her everything outranks the limit on the list.
    const space = createSpace(db, lorna, { name: "Fam" }, "web");
    setProjectSpace(db, lorna, list.id, space.id, "web");
    inviteSpaceMember(db, lorna, space.id, "jo", "web", "viewer");
    acceptSpaceInvite(db, jo, space.id, "web");
    expect(getItem(db, jo, swim.id)).toBeDefined();
  });

  it("is lifted when they're made an editor, and editors can't be limited", () => {
    const { db, lorna, jo, list, party } = setup();
    setMemberRole(db, lorna, list.id, jo, "editor", "web");
    expect(getItem(db, jo, party.id)).toBeDefined();
    setMemberRole(db, lorna, list.id, jo, "viewer", "web");
    expect(getItem(db, jo, party.id)).toBeDefined();
    const other = createProject(db, lorna, { name: "Other" }, "web");
    expect(() => inviteMember(db, lorna, other.id, "jo", "web", "editor", { onlyMine: true })).toThrow(
      /viewers and commenters/,
    );
  });

  it("limits a Space membership the same way", () => {
    const { db, lorna, fred } = setup();
    const kim = createTestUser(db, { username: "kim", name: "Kim" });
    const space = createSpace(db, lorna, { name: "Fam" }, "web");
    const home = createProject(db, lorna, { name: "Home", spaceId: space.id }, "web");
    const mine = addItem(db, lorna, { projectId: home.id, title: "Mine", assigneeIds: [lorna] }, "web");
    const hidden = addItem(db, lorna, { projectId: home.id, title: "SECRET home" }, "web");
    inviteSpaceMember(db, lorna, space.id, "kim", "web", "viewer", { onlyMine: true });
    acceptSpaceInvite(db, kim, space.id, "web");
    expect(everything(db, kim, home.id, [mine.id, hidden.id])).not.toContain("SECRET");
    expect(getItem(db, kim, mine.id)?.title).toBe("Mine");
    expect(getItem(db, fred, mine.id)).toBeUndefined();
  });
});
