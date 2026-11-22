import { eq } from "drizzle-orm";
import { users } from "./auth-schema";
import { setDayNote, sharedDayNote } from "./dayNotes";
import { listDayShares, myDayView, stopDayShare, updateDayShare } from "./dayShares";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "./audit";
import { addLabel, listLabels, updateLabel } from "./labels";
import { createTestDb, createTestUser } from "./test-helpers";
import { addItem, getItem, getItemWithSubItems, hiddenParentTitles, listDoneBefore, listItems, listSubItems, setItemParent } from "./items";
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
import { acceptInvite, inviteMember, listAssignees, listMembers, removeMember, setMemberRole } from "./members";
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
    const { db, lorna, fred, jo, vic, list, party, errand, swim } = setup();
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
    expect([...limitedListsById(db, jo)]).toEqual([[list.id, { personId: lorna, username: "lorna", name: "Lorna", image: null, within: null, day: null, turnsAt: null }]]);
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

describe("a membership shown only someone's today or week", () => {
  // Thursday 19 November 2026, 10am in London.
  const THU = Date.parse("2026-11-19T10:00:00Z");
  afterEach(() => vi.useRealTimers());

  function setup(within: "today" | "week", timeZone = "Europe/London") {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(THU);
    const { db } = createTestDb();
    const lorna = createTestUser(db, { username: "lorna", name: "Lorna" });
    const fred = createTestUser(db, { username: "fred", name: "Fred" });
    const jo = createTestUser(db, { username: "jo", name: "Jo" });
    db.update(users).set({ timeZone }).where(eq(users.id, lorna)).run();
    const list = createProject(db, lorna, { name: "Week" }, "web");
    inviteMember(db, lorna, list.id, "fred", "web", "editor");
    acceptInvite(db, fred, list.id, "web");
    inviteMember(db, lorna, list.id, "jo", "web", "viewer", { onlyMine: true, within });
    acceptInvite(db, jo, list.id, "web");
    const mine = (title: string, dueDate?: string, dueFrom?: string) =>
      addItem(db, lorna, { projectId: list.id, title, assigneeIds: [lorna], dueDate, dueFrom }, "web");
    mine("Due today", "2026-11-19");
    mine("Overdue", "2026-11-17");
    mine("Tomorrow", "2026-11-20");
    mine("Next Monday", "2026-11-23");
    mine("Sunday", "2026-11-22");
    mine("This week span", "2026-11-20", "2026-11-16");
    mine("No date");
    completeItem(db, lorna, mine("Done early", "2026-11-21").id, "web");
    addItem(db, fred, { projectId: list.id, title: "Fred's today", assigneeIds: [fred], dueDate: "2026-11-19" }, "web");
    // An undated item of hers with one line due today shows whole.
    const tidy = addItem(db, lorna, { projectId: list.id, title: "Tidy", assigneeIds: [lorna], subItems: ["Kitchen"] }, "web");
    updateItem(db, lorna, listSubItems(db, lorna, tidy.id)[0].id, { dueDate: "2026-11-19" }, "web");
    // Finished yesterday, Wednesday.
    vi.setSystemTime(THU - 86_400_000);
    completeItem(db, lorna, mine("Done yesterday", "2026-11-18").id, "web");
    vi.setSystemTime(THU);
    const seen = () => listItems(db, jo, list.id, { includeCompleted: true }).map((i) => i.title).sort();
    return { db, lorna, fred, jo, list, seen };
  }

  it("shows today's: due, overdue, a span that's begun, and done today, by her clock", () => {
    const { seen } = setup("today");
    expect(seen()).toEqual(["Done early", "Due today", "Kitchen", "Overdue", "This week span", "Tidy"]);
    // 3:59am on Friday in London is still her Thursday; at 4am it's Friday.
    vi.setSystemTime(Date.parse("2026-11-20T03:59:00Z"));
    expect(seen()).toContain("Done early");
    vi.setSystemTime(Date.parse("2026-11-20T04:00:00Z"));
    expect(seen()).toEqual(["Due today", "Kitchen", "Overdue", "This week span", "Tidy", "Tomorrow"]);
  });

  it("goes by her time zone, not the server's or Jo's", () => {
    // 5am UTC on Friday, already Friday by the server, is still Thursday
    // midnight (before her 4am) in New York.
    const { seen } = setup("today", "America/New_York");
    vi.setSystemTime(Date.parse("2026-11-20T05:00:00Z"));
    expect(seen()).toContain("Due today");
    expect(seen()).not.toContain("Tomorrow");
  });

  it("shows this week's, Monday to Sunday, and done this week", () => {
    const { db, lorna, jo, list, seen } = setup("week");
    expect([...limitedListsById(db, jo)]).toEqual([
      // Her next 4am, in London, when what Jo's shown changes.
      [list.id, { personId: lorna, username: "lorna", name: "Lorna", image: null, within: "week", day: "2026-11-16", turnsAt: Date.parse("2026-11-20T04:00:00Z") }],
    ]);
    expect(seen()).toEqual([
      "Done early", "Done yesterday", "Due today", "Kitchen", "Overdue", "Sunday", "This week span", "Tidy", "Tomorrow",
    ]);
  });

  it("says it's her day or week when Jo's invited, joins and is changed", () => {
    const { db, lorna, jo, list } = setup("today");
    const said = (u: string) => listNotifications(db, u).map((n) => plainText(n.parts));
    expect(said(jo)).toContain('Lorna invited you to "Week" as a viewer of @lorna\'s day');
    expect(said(lorna)).toContain('Jo joined "Week" as a viewer of your day');
    setMemberRole(db, lorna, list.id, jo, "viewer", "web", undefined, "week");
    expect(listAudit(db, lorna, { projectId: list.id }).map((e) => e.detail)).toContainEqual(
      expect.stringMatching(/seeing only @lorna's week/),
    );
  });

  it("shows her note's words or mood only as she chose, for her today, once Kim's joined", () => {
    const { db, lorna, jo } = setup("today");
    const kim = createTestUser(db, { username: "kim" });
    const home = createProject(db, lorna, { name: "Home" }, "web");
    inviteMember(db, lorna, home.id, "kim", "web", "viewer", { onlyMine: true, within: "today", shareMood: true });
    // Jo has her day, but not her note: nothing of it.
    setDayNote(db, lorna, "2026-11-18", "Unwell — yesterday's");
    setDayNote(db, lorna, "2026-11-19", "Tired, Busy — long day at work");
    expect(sharedDayNote(db, jo, lorna)).toEqual({ note: null, mood: [] });
    // Kim's invite is pending until she accepts.
    expect(sharedDayNote(db, kim, lorna)).toEqual({ note: null, mood: [] });
    acceptInvite(db, kim, home.id, "web");
    expect(sharedDayNote(db, kim, lorna)).toEqual({ note: null, mood: ["Busy", "Tired"] });
    // A share that allows more wins.
    const away = createProject(db, lorna, { name: "Away" }, "web");
    inviteMember(db, lorna, away.id, "kim", "web", "viewer", { onlyMine: true, within: "week", shareNote: true });
    acceptInvite(db, kim, away.id, "web");
    expect(sharedDayNote(db, kim, lorna)).toEqual({ note: "long day at work", mood: ["Busy", "Tired"] });
    // Only while it's a day share: kept to her items for all time, it stops.
    setMemberRole(db, lorna, away.id, kim, "viewer", "web", undefined, null);
    setMemberRole(db, lorna, home.id, kim, "viewer", "web", undefined, null);
    expect(sharedDayNote(db, kim, lorna)).toEqual({ note: null, mood: [] });
  });

  it("stops showing her note once the day share ends, even when another day share is set later", () => {
    const { db, lorna, jo } = setup("today");
    const sam = createTestUser(db, { username: "sam" });
    setDayNote(db, lorna, "2026-11-19", "Tired — private words");
    const home = createProject(db, lorna, { name: "Home" }, "web");
    inviteMember(db, lorna, home.id, "jo", "web", "viewer", { onlyMine: true, within: "today", shareNote: true, shareMood: true });
    acceptInvite(db, jo, home.id, "web");
    expect(sharedDayNote(db, jo, lorna).note).toBe("private words");
    // Kept to her items for all time, then her week again: not opted in again.
    setMemberRole(db, lorna, home.id, jo, "viewer", "web", undefined, null);
    setMemberRole(db, lorna, home.id, jo, "viewer", "web", undefined, "week");
    expect(sharedDayNote(db, jo, lorna)).toEqual({ note: null, mood: [] });

    // In a Space, another admin can't revive it, nor take it over as theirs.
    const space = createSpace(db, lorna, { name: "Fam" }, "web");
    inviteSpaceMember(db, lorna, space.id, "sam", "web", "member");
    acceptSpaceInvite(db, sam, space.id, "web");
    setSpaceMemberRole(db, lorna, space.id, sam, "admin", "web");
    inviteSpaceMember(db, lorna, space.id, "jo", "web", "commenter", { onlyMine: true, within: "today", shareNote: true });
    acceptSpaceInvite(db, jo, space.id, "web");
    expect(sharedDayNote(db, jo, lorna).note).toBe("private words");
    setSpaceMemberRole(db, sam, space.id, jo, "commenter", "web", true);
    setDayNote(db, sam, "2026-11-19", "Sam's own words");
    expect(sharedDayNote(db, jo, lorna)).toEqual({ note: null, mood: [] });
    expect(sharedDayNote(db, jo, sam)).toEqual({ note: null, mood: [] });
  });

  it("lists, changes and stops her day shares, and shows her exactly what Jo sees", () => {
    const { db, lorna, jo, list, seen } = setup("today");
    createTestUser(db, { username: "kim", name: "Kim" });
    const space = createSpace(db, lorna, { name: "Fam" }, "web");
    inviteSpaceMember(db, lorna, space.id, "kim", "web", "commenter", { onlyMine: true, within: "week", shareMood: true });
    const title = (id: string) => getItem(db, lorna, id)?.title;
    expect(listDayShares(db, lorna).map((s) => [s.name, s.within, s.note, s.mood, s.pending, s.places.map((p) => p.name)])).toEqual([
      ["Jo", "today", false, false, false, ["Week"]],
      ["Kim", "week", false, true, true, ["Fam"]],
    ]);
    // Her day, as she sees it on Check-ins, is what Jo sees: Kim's week
    // doesn't count until she's accepted, nor does the mood Kim would see.
    // Nor a list Jo hasn't accepted yet.
    const gym = createProject(db, lorna, { name: "Gym" }, "web");
    addItem(db, lorna, { projectId: gym.id, title: "Gym today", assigneeIds: [lorna], dueDate: "2026-11-19" }, "web");
    inviteMember(db, lorna, gym.id, "jo", "web", "viewer", { onlyMine: true, within: "today" });
    setDayNote(db, lorna, "2026-11-19", "Tired — words");
    const mine = myDayView(db, lorna);
    expect([mine.within, mine.note, mine.mood]).toEqual(["today", null, []]);
    expect(mine.itemIds.map(title).sort()).toEqual(seen());

    updateDayShare(db, lorna, jo, { within: "week", note: true }, "web");
    expect(seen()).toContain("Tomorrow");
    expect(myDayView(db, lorna).within).toBe("week");
    expect(myDayView(db, lorna).itemIds.map(title).sort()).toEqual(seen());
    expect(sharedDayNote(db, jo, lorna)).toEqual({ note: "words", mood: [] });
    expect(listAudit(db, lorna, { projectId: list.id }).map((r) => plainText(r.parts ?? []))).toContainEqual(expect.stringContaining("with the day note"));
    updateDayShare(db, lorna, jo, { note: false }, "web");
    expect(sharedDayNote(db, jo, lorna).note).toBeNull();
    expect(seen()).toContain("Tomorrow");

    stopDayShare(db, lorna, jo, "web");
    expect(listDayShares(db, lorna).map((s) => s.name)).toEqual(["Kim"]);
    expect(() => listItems(db, jo, list.id)).not.toThrow();
    expect(listItems(db, jo, list.id)).toEqual([]);
    expect(() => updateDayShare(db, jo, lorna, { within: "today" }, "web")).toThrow(/don't share your day/);
  });

  it("lets her change or stop her day share in a Space she no longer runs", () => {
    const { db, lorna, list } = setup("today");
    const bob = createTestUser(db, { username: "bob" });
    const kim = createTestUser(db, { username: "kim", name: "Kim" });
    const space = createSpace(db, bob, { name: "Fam" }, "web");
    inviteSpaceMember(db, bob, space.id, "lorna", "web", "member");
    acceptSpaceInvite(db, lorna, space.id, "web");
    setSpaceMemberRole(db, bob, space.id, lorna, "admin", "web");
    inviteSpaceMember(db, lorna, space.id, "kim", "web", "commenter", { onlyMine: true, within: "today" });
    inviteMember(db, lorna, list.id, "kim", "web", "commenter", { onlyMine: true, within: "today" });
    setSpaceMemberRole(db, bob, space.id, lorna, "member", "web");

    updateDayShare(db, lorna, kim, { within: "week" }, "web");
    expect(listDayShares(db, lorna).find((s) => s.name === "Kim")?.within).toBe("week");
    // Only what of her day is shared, not Kim's role.
    expect(() => setSpaceMemberRole(db, lorna, space.id, kim, "viewer", "web")).toThrow(/only a space admin/);
    // Nor her day into all her items, for good.
    expect(() => setSpaceMemberRole(db, lorna, space.id, kim, "commenter", "web", true, null)).toThrow(/only a space admin/);
    stopDayShare(db, lorna, kim, "web");
    expect(listDayShares(db, lorna).map((s) => s.name)).toEqual(["Jo"]);
  });

  it("lets an editor share her own day on someone else's list: just her items, the owner told, until she's off it", () => {
    const { db, lorna, fred, jo, seen: onWeek } = setup("today");
    const kim = createTestUser(db, { username: "kim", name: "Kim" });
    const home = createProject(db, fred, { name: "Home" }, "web");
    inviteMember(db, fred, home.id, "lorna", "web", "editor");
    acceptInvite(db, lorna, home.id, "web");
    inviteMember(db, fred, home.id, "kim", "web", "commenter");
    acceptInvite(db, kim, home.id, "web");
    const today = "2026-11-19";
    const add = (title: string, who: string, parentId?: string) =>
      addItem(db, fred, { projectId: home.id, title, assigneeIds: [who], dueDate: today, ...(parentId ? { parentId } : {}) }, "web");
    add("Lorna's errand", lorna);
    const chores = add("Fred's chores", fred);
    add("Lorna's bit", lorna, chores.id);
    add("Fred's bit", fred, chores.id);
    const task = add("Lorna's task", lorna);
    add("Fred helps", fred, task.id);
    add("Fred's own", fred);

    // Kim only comments there, so it isn't hers to share.
    expect(() => inviteMember(db, kim, home.id, "jo", "web", "commenter", { onlyMine: true, within: "today" })).toThrow(/only the list owner/);
    // Nor can Lorna share more than her day.
    expect(() => inviteMember(db, lorna, home.id, "jo", "web", "commenter", { onlyMine: true })).toThrow(/only the list owner/);
    inviteMember(db, lorna, home.id, "jo", "web", "commenter", { onlyMine: true, within: "today" });
    expect(listNotifications(db, fred).map((n) => plainText(n.parts))).toContainEqual(expect.stringContaining("Jo"));
    acceptInvite(db, jo, home.id, "web");

    const seen = () => listItems(db, jo, home.id, { includeCompleted: true }).map((i) => i.title).sort();
    // Her items only: not Fred's item her sub-item sits under, just its title.
    expect(seen()).toEqual(["Lorna's bit", "Lorna's errand", "Lorna's task"]);
    expect(hiddenParentTitles(db, jo)[chores.id]).toBe("Fred's chores");
    expect(() => addComment(db, jo, chores.id, "hi", "web")).toThrow();
    const title = (id: string) => getItem(db, lorna, id)?.title;
    expect(myDayView(db, lorna).itemIds.map(title).sort()).toEqual([...onWeek(), ...seen()].sort());

    // Nor through the item's own view, or its history.
    expect(getItemWithSubItems(db, jo, chores.id)).toEqual([]);
    expect(listAudit(db, jo, { itemId: task.id }).map((r) => plainText(r.parts ?? [])).join()).not.toContain("Fred helps");
    // Her undated item doesn't land in her day by Fred's sub-item under it.
    const undated = addItem(db, fred, { projectId: home.id, title: "Lorna undated", assigneeIds: [lorna] }, "web");
    add("Fred's today", fred, undated.id);
    expect(seen()).not.toContain("Lorna undated");

    // She manages it like any day share of hers; Fred can still remove Jo.
    expect(listDayShares(db, lorna).find((s) => s.name === "Jo")?.places.map((p) => p.name)).toEqual(["Week", "Home"]);
    expect(() => setMemberRole(db, lorna, home.id, jo, "viewer", "web")).toThrow(/only the list owner/);
    expect(() => setMemberRole(db, lorna, home.id, jo, "commenter", "web", undefined, null)).toThrow(/only the list owner/);
    // Fred's list shows whose day Jo sees: Lorna's, not his.
    expect(listMembers(db, fred, home.id).find((m) => m.userId === jo)?.sharerName).toBe("Lorna");

    // Fred making it only his items doesn't turn it into a share of his day.
    const sam = createTestUser(db, { username: "sam", name: "Sam" });
    inviteMember(db, lorna, home.id, "sam", "web", "viewer", { onlyMine: true, within: "today" });
    setMemberRole(db, fred, home.id, sam, "viewer", "web", true);
    expect(listMembers(db, fred, home.id).find((m) => m.userId === sam)).toMatchObject({ onlyAssignedTo: fred, onlyWithin: null });
    expect(listDayShares(db, fred)).toEqual([]);
    expect(listDayShares(db, lorna).map((s) => s.name)).not.toContain("Sam");

    // Off the list, her share ends there: Jo leaves it, and the log says so.
    removeMember(db, fred, home.id, lorna, "web");
    expect(listAccess(db, jo, home.id)).toBeNull();
    expect(listDayShares(db, lorna).find((s) => s.name === "Jo")?.places.map((p) => p.name)).toEqual(["Week"]);
    expect(listAudit(db, fred, { projectId: home.id }).map((r) => plainText(r.parts ?? []))).toContainEqual(
      expect.stringContaining("stopped sharing their day with 1 person"),
    );
  });

  it("is kept with a role change, cleared with the limit, and needs one", () => {
    const { db, lorna, jo, list, seen } = setup("today");
    setMemberRole(db, lorna, list.id, jo, "commenter", "web");
    expect(seen()).not.toContain("Tomorrow");
    setMemberRole(db, lorna, list.id, jo, "commenter", "web", undefined, "week");
    expect(seen()).toContain("Tomorrow");
    setMemberRole(db, lorna, list.id, jo, "commenter", "web", false);
    expect(seen()).toContain("No date");
    expect(() => setMemberRole(db, lorna, list.id, jo, "commenter", "web", undefined, "today")).toThrow(/just your items/);
  });
});
