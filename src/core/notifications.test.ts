import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishWork, startWork } from "./agentSessions";
import { addComment, updateComment } from "./comments";
import { plainText } from "./describe";
import { addItem, completeItem, listItems, reopenDueRepeats, uncompleteItem, updateItem } from "./items";
import { moveItem, previewMoveItem } from "./move";
import { setFollowing } from "./follows";
import { acceptInvite, inviteMember, removeMember } from "./members";
import {
  deliverNotifications,
  listNotifications,
  markNotificationsRead,
  setNotificationLevel,
} from "./notifications";
import { createProject, deleteProject, updateProject } from "./projects";
import { markLooking } from "./presence";
import { remindDue } from "./reminders";
import { savePushSubscription } from "./push";
import {
  acceptSpaceInvite,
  createSpace,
  deleteSpace,
  inviteSpaceMember,
  removeSpaceMember,
  setProjectSpace,
  setSpaceMemberRole,
  updateSpace,
} from "./spaces";
import { createTestDb, createTestUser } from "./test-helpers";
import { dayOf, weekSpan } from "../lib/time";

const sendPush = vi.hoisted(() => vi.fn(async () => ({ sent: 1, gone: [] as string[] })));
vi.mock("../lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/push")>()),
  sendPush,
}));
const VAPID = { publicKey: "server-key", privateKey: "priv", subject: "https://sidetrack.it" };
vi.mock("../lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/env")>();
  return { ...actual, getEnv: () => ({ ...actual.getEnv(), VAPID }) };
});

const AMP = { source: "mcp" as const, agent: { keyId: "key-amp", name: "Amp" } };

function seed() {
  const { db } = createTestDb();
  const fred = createTestUser(db, { username: "fred", name: "Fred" });
  const alice = createTestUser(db, { username: "alice", name: "Alice" });
  const list = createProject(db, fred, { name: "Home" }, "web");
  inviteMember(db, fred, list.id, "alice", "web");
  acceptInvite(db, alice, list.id, "web");
  // Alice's invite, and Fred hearing she joined.
  markNotificationsRead(db, alice);
  markNotificationsRead(db, fred);
  return { db, fred, alice, listId: list.id };
}

/**
 * What's unread in the user's inbox, as a push would say it: what's aimed
 * at them or what they follow, or with `ambient`, only list and Space activity.
 */
const unread = (db: ReturnType<typeof seed>["db"], userId: string, ambient = false) =>
  listNotifications(db, userId).flatMap((n) =>
    n.readAt === null && (n.reason === "activity") === ambient
      ? [plainText(n.parts) + (n.snippet ? `: ${n.snippet}` : "")]
      : [],
  );

/** A phone for `userId` to push to. */
function subscribe(db: ReturnType<typeof seed>["db"], userId: string) {
  const keys = {
    p256dh: Buffer.alloc(65, 4).toString("base64url"),
    auth: Buffer.alloc(16, 1).toString("base64url"),
  };
  savePushSubscription(db, userId, { endpoint: `https://web.push.apple.com/${userId}`, keys, deviceLabel: "iPhone" }, VAPID.publicKey);
}

/** When every group written so far is due to push. */
const due = () => Date.now() + 5 * 60_000;

beforeEach(() => sendPush.mockClear());
// A millisecond on each time it's read, so notifications list in the order
// things happened: changes in the same millisecond have none.
beforeEach(() => {
  let t = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => ++t);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("notifications", () => {
  it("tells newly assigned people, never the person assigning", () => {
    const { db, fred, alice, listId } = seed();
    const item = addItem(db, fred, { projectId: listId, title: "Fix tap", assigneeIds: [fred, alice] }, "web");
    expect(unread(db, alice)).toEqual(['Fred added "Fix tap" for you']);
    expect(unread(db, fred)).toEqual([]);
    // Alice is already on it, so a rename that keeps her is news to nobody.
    updateItem(db, fred, item.id, { title: "Fix the tap", assigneeIds: [alice] }, "web");
    expect(unread(db, alice)).toHaveLength(1);
    updateItem(db, alice, item.id, { assigneeIds: [alice, fred] }, "web");
    expect(unread(db, fred)).toEqual(['Alice assigned you "Fix the tap"']);
    expect(listNotifications(db, fred)[0]).toMatchObject({
      title: "Home",
      url: `/board?p=${listId}&item=${item.id}`,
      itemRef: "HOM-1",
      reason: "assigned",
    });
  });

  it("says what it's about by its current name, and only while the reader can open it", () => {
    const { db, fred, alice, listId } = seed();
    const item = addItem(db, fred, { projectId: listId, title: "Fix tap", assigneeIds: [alice] }, "web");
    updateItem(db, fred, item.id, { title: "Fix the kitchen tap" }, "web");
    updateProject(db, fred, listId, { name: "Flat" }, "web");
    // The seed's invite stays as it was sent; the assignment reads as it is now.
    const assigned = () =>
      listNotifications(db, alice)
        .filter((n) => n.reason === "assigned")
        .map((n) => [n.title, plainText(n.parts)]);
    expect(assigned()).toEqual([["Flat", 'Fred added "Fix the kitchen tap" for you']]);
    removeMember(db, fred, listId, alice, "web");
    expect(assigned()).toEqual([]);
  });

  it("tells someone about their own change when their agent made it", () => {
    const { db, fred, listId } = seed();
    const item = addItem(db, fred, { projectId: listId, title: "Ship it" }, "web");
    updateItem(db, fred, item.id, { assigneeIds: [fred] }, AMP);
    startWork(db, fred, item.id, {}, AMP);
    finishWork(db, fred, item.id, { note: "Merged #12" }, AMP);
    // The rest is Fred's own doing, though he follows it.
    addComment(db, fred, item.id, "Done, see #12", AMP);
    completeItem(db, fred, item.id, AMP);
    expect(unread(db, fred, true)).toEqual([]);
    expect(unread(db, fred).sort()).toEqual([
      'Amp assigned you "Ship it"',
      'Amp finished work on "Ship it": Merged #12',
    ]);
    const finished = listNotifications(db, fred).find((n) => n.reason === "agent-finished");
    expect(finished).toMatchObject({
      parts: [
        { text: "Amp", em: "person" },
        { text: " finished work on " },
        // Completed since, so it reads struck through.
        { text: "Ship it", em: "item", quote: true, done: true },
      ],
      snippet: "Merged #12",
      agentName: "Amp",
      actor: { userId: fred, name: "Fred" },
    });
  });

  it("marks one notification seen, or all of them", () => {
    const { db, fred, alice, listId } = seed();
    addItem(db, fred, { projectId: listId, title: "Fix tap", assigneeIds: [alice] }, "web");
    addItem(db, fred, { projectId: listId, title: "Mow lawn", assigneeIds: [alice] }, "web");
    const tap = listNotifications(db, alice).filter((n) => plainText(n.parts).includes("Fix tap"));
    markNotificationsRead(db, alice, tap.map((n) => n.id));
    expect(unread(db, alice)).toEqual(['Fred added "Mow lawn" for you']);
    // Someone else's id marks nothing of theirs.
    markNotificationsRead(db, fred, listNotifications(db, alice).map((n) => n.id));
    expect(unread(db, alice)).toHaveLength(1);
    markNotificationsRead(db, alice);
    expect(unread(db, alice)).toEqual([]);
  });

  it("lists every unseen one, and fills the inbox past ones the reader lost", () => {
    const { db, fred, alice, listId } = seed();
    const other = createProject(db, fred, { name: "Work" }, "web");
    inviteMember(db, fred, other.id, "alice", "web");
    acceptInvite(db, alice, other.id, "web");
    for (let i = 0; i < 20; i++) {
      addItem(db, fred, { projectId: listId, title: `Home ${i}`, assigneeIds: [alice] }, "web");
    }
    for (let i = 0; i < 80; i++) {
      addItem(db, fred, { projectId: other.id, title: `Work ${i}`, assigneeIds: [alice] }, "web");
    }
    // All 100 are unseen, well past the inbox's usual 30, so the count
    // reaches them all (and her invite to Work).
    expect(unread(db, alice).filter((t) => t.includes(" added "))).toHaveLength(100);
    markNotificationsRead(db, alice);
    // Losing Work drops its 80; older ones from Home fill the inbox instead.
    removeMember(db, fred, other.id, alice, "web");
    const assigned = listNotifications(db, alice)
      .filter((n) => n.reason === "assigned")
      .map((n) => n.title);
    expect(assigned).toEqual(Array(20).fill("Home"));
  });

  it("keeps what other people's agents do to the inbox, or as chosen, but pushes what's for you", async () => {
    const { db, fred, alice, listId } = seed();
    subscribe(db, fred);
    const item = addItem(db, fred, { projectId: listId, title: "Ship it" }, "web");
    await deliverNotifications(db, due());
    sendPush.mockClear();
    // Fred follows what he created, but Alice's agent working on it waits.
    addComment(db, alice, item.id, "On it", AMP);
    completeItem(db, alice, item.id, AMP);
    await deliverNotifications(db, due());
    expect(sendPush).not.toHaveBeenCalled();
    expect(unread(db, fred)).toEqual(['Amp completed "Ship it"', 'Amp commented on "Ship it": On it']);
    // Assigning him is for him: it pushes.
    const next = addItem(db, alice, { projectId: listId, title: "Review it" }, "web");
    updateItem(db, alice, next.id, { assigneeIds: [fred] }, AMP);
    await deliverNotifications(db, due());
    expect(sendPush).toHaveBeenCalledTimes(1);
    sendPush.mockClear();
    // Like a person's, as chosen.
    setNotificationLevel(db, fred, "agents", "all");
    uncompleteItem(db, alice, item.id, AMP);
    await deliverNotifications(db, due());
    expect(sendPush).toHaveBeenCalledTimes(1);
    // Or only what's for him.
    markNotificationsRead(db, fred);
    setNotificationLevel(db, fred, "agents", "mine");
    completeItem(db, alice, item.id, AMP);
    expect(unread(db, fred)).toEqual([]);
    // People are heard as before.
    uncompleteItem(db, alice, item.id, "web");
    expect(unread(db, fred)).toEqual(['Alice reopened "Ship it"']);
  });

  it("tells an item's followers what moved, and creators, assignees and commenters follow", () => {
    const { db, fred, alice, listId } = seed();
    const bob = createTestUser(db, { username: "bob", name: "Bob" });
    inviteMember(db, fred, listId, "bob", "web");
    acceptInvite(db, bob, listId, "web");
    markNotificationsRead(db, fred);
    markNotificationsRead(db, bob);
    // Fred created it; Alice is assigned; Bob comments.
    const item = addItem(db, fred, { projectId: listId, title: "Fix tap", assigneeIds: [alice] }, "web");
    addComment(db, bob, item.id, "I can lend a wrench", "web");
    markNotificationsRead(db, alice);
    markNotificationsRead(db, fred);
    completeItem(db, alice, item.id, "web");
    expect(unread(db, fred)).toEqual(['Alice completed "Fix tap"']);
    expect(unread(db, bob)).toEqual(['Alice completed "Fix tap"']);
    expect(unread(db, alice)).toEqual([]);
    // Unfollowing sticks, even through a later comment.
    setFollowing(db, bob, item.id, false);
    addComment(db, bob, item.id, "Still around", "web");
    uncompleteItem(db, alice, item.id, "web");
    expect(unread(db, bob)).toEqual(['Alice completed "Fix tap"']);
    expect(unread(db, fred)).toEqual([
      'Alice reopened "Fix tap"',
      'Bob commented on "Fix tap": Still around',
      'Alice completed "Fix tap"',
    ]);
  });

  it("tells someone taken off an item, once, and not as a follower too", () => {
    const { db, fred, alice, listId } = seed();
    const item = addItem(db, fred, { projectId: listId, title: "Fix tap", assigneeIds: [alice] }, "web");
    markNotificationsRead(db, alice);
    updateItem(db, fred, item.id, { assigneeIds: [], dueDate: "2026-12-01" }, "web");
    expect(unread(db, alice)).toEqual(['Fred took you off "Fix tap"']);
    // Still following, so the next change reaches her.
    updateItem(db, fred, item.id, { dueDate: null }, "web");
    expect(unread(db, alice)[0]).toBe('Fred cleared the due date on "Fix tap"');
  });

  it("rolls a sub-item's activity up to its parent's followers", () => {
    const { db, fred, alice, listId } = seed();
    const parent = addItem(db, fred, { projectId: listId, title: "Pack" }, "web");
    setFollowing(db, alice, parent.id, true);
    const sub = addItem(db, fred, { projectId: listId, title: "Socks", parentId: parent.id }, "web");
    // Another still open, so ticking Socks doesn't finish Pack too.
    addItem(db, fred, { projectId: listId, title: "Hat", parentId: parent.id }, "web");
    markNotificationsRead(db, alice);
    completeItem(db, fred, sub.id, "web");
    expect(unread(db, alice)).toEqual(['Fred completed "Socks"']);
  });

  it("reminds assignees of what's due each morning, once, and the morning after if it's still open", async () => {
    // Before that morning's reminders: the items are made, then reminded of,
    // whatever the real clock says.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 20, 6));
    const { db, fred, alice, listId } = seed();
    subscribe(db, alice);
    await deliverNotifications(db, due());
    sendPush.mockClear();
    // Alice hasn't saved a time zone, so her mornings are UTC's.
    const at = (day: number, hour: number) => Date.UTC(2026, 10, day, hour);
    const bins = addItem(
      db,
      fred,
      { projectId: listId, title: "Bins", assigneeIds: [alice], dueDate: "2026-11-20", repeat: { every: 1, unit: "day" } },
      "web",
    );
    const rent = addItem(db, fred, { projectId: listId, title: "Rent", assigneeIds: [alice], dueDate: "2026-11-20" }, "web");
    // Fred's (he hears of it), unassigned, and done: none of hers.
    addItem(db, fred, { projectId: listId, title: "Gas", assigneeIds: [fred], dueDate: "2026-11-20" }, "web");
    addItem(db, fred, { projectId: listId, title: "Water", dueDate: "2026-11-20" }, "web");
    addItem(db, fred, { projectId: listId, title: "Paid", assigneeIds: [alice], dueDate: "2026-11-20", completed: true }, "web");
    updateProject(db, fred, listId, { icon: "🏠" }, "web");
    markNotificationsRead(db, alice);
    const reminders = () =>
      listNotifications(db, alice)
        .filter((n) => n.reason === "due-today" || n.reason === "overdue")
        .map((n) => plainText(n.parts));
    // Not before 8am, then once however often it runs.
    expect(remindDue(db, at(20, 7))).toBe(0);
    expect(remindDue(db, at(20, 8))).toBe(3);
    expect(remindDue(db, at(20, 12))).toBe(0);
    expect(reminders().sort()).toEqual(['"Bins" is due today', '"Rent" is due today']);
    // One push for the morning's lot.
    await deliverNotifications(db, at(20, 8) + 60_000);
    // Fred has no devices, so only Alice's lot reaches a phone.
    const calls = sendPush.mock.calls as unknown as Array<[unknown[], unknown]>;
    const hers = calls.filter(([targets]) => targets.length > 0);
    expect(hers).toHaveLength(1);
    expect(hers[0][1]).toMatchObject({
      title: "Due",
      url: "/brief",
      body: expect.stringMatching(/^"(Bins|Rent)" and "(Bins|Rent)" are due today$/),
    });
    // Next morning, once more for what's still open; then no more.
    completeItem(db, alice, rent.id, "web");
    expect(remindDue(db, at(21, 9))).toBe(2);
    expect(reminders()[0]).toBe('"Bins" is overdue');
    // Just one: the item's the title, the list and its emoji in the body.
    sendPush.mockClear();
    await deliverNotifications(db, at(21, 9) + 60_000);
    const alone = (sendPush.mock.calls as unknown as Array<[unknown[], unknown]>).filter(([t]) => t.length > 0);
    expect(alone).toHaveLength(1);
    expect(alone[0][1]).toMatchObject({ title: "“Bins”", body: "Overdue • 🏠 Home" });
    expect(remindDue(db, at(22, 9))).toBe(0);
    // Coming round again by its repeat rule is told by its reminder, not as news.
    completeItem(db, alice, bins.id, "web");
    markNotificationsRead(db, alice);
    reopenDueRepeats(db, fred, { timeZone: "UTC", now: Date.now() + 2 * 86_400_000 });
    expect(unread(db, alice)).toEqual([]);
  });

  it("keeps due reminders to the inbox, or off, as chosen", async () => {
    const { db, fred, alice, listId } = seed();
    subscribe(db, alice);
    addItem(db, fred, { projectId: listId, title: "Bins", assigneeIds: [alice], dueDate: "2026-11-20" }, "web");
    await deliverNotifications(db, due());
    sendPush.mockClear();
    setNotificationLevel(db, alice, "reminders", "default");
    remindDue(db, Date.UTC(2026, 10, 20, 9));
    await deliverNotifications(db, Date.UTC(2026, 10, 20, 10));
    expect(sendPush).not.toHaveBeenCalled();
    expect(unread(db, alice)).toContain('"Bins" is due today');
    setNotificationLevel(db, alice, "reminders", "mine");
    expect(remindDue(db, Date.UTC(2026, 10, 21, 9))).toBe(0);
  });

  it("tells one action once, not once per sub-item it carries", () => {
    const { db, fred, alice, listId } = seed();
    // Added with its lines: the assignment, not a line each.
    const trip = addItem(
      db,
      fred,
      { projectId: listId, title: "Trip", assigneeIds: [alice], subItems: ["Socks", "Hat"] },
      "web",
    );
    expect(unread(db, alice)).toEqual(['Fred added "Trip" for you']);
    // Logged as already done, with its lines: nothing at all.
    addItem(
      db,
      fred,
      { projectId: listId, title: "Logged", assigneeIds: [alice], completed: true, subItems: ["a"] },
      "web",
    );
    expect(unread(db, alice)).toHaveLength(1);
    markNotificationsRead(db, alice);
    // Moved with its lines: the move, once.
    const ops = createProject(db, fred, { name: "Ops" }, "web");
    inviteMember(db, fred, ops.id, "alice", "web");
    acceptInvite(db, alice, ops.id, "web");
    markNotificationsRead(db, alice);
    moveItem(db, fred, trip.id, { projectId: ops.id, token: previewMoveItem(db, fred, trip.id, ops.id).token }, "web");
    expect(unread(db, alice)).toEqual(['Fred moved "Trip" to "Ops"']);
    markNotificationsRead(db, alice);
    // Ticking the last open line completes the parent: told as the parent.
    const [socks, hat] = listItems(db, fred, ops.id).filter((i) => i.parentId === trip.id);
    completeItem(db, fred, socks.id, "web");
    completeItem(db, fred, hat.id, "web");
    expect(unread(db, alice)).toEqual(['Fred completed "Trip"', 'Fred completed "Socks"']);
  });

  it("tells a list's owner and a Space's admins who joined, and someone their new role", () => {
    const { db, fred, alice } = seed();
    expect(listNotifications(db, fred).map((n) => plainText(n.parts))).toEqual(['Alice joined "Home"']);
    const space = createSpace(db, fred, { name: "Family" }, "web");
    inviteSpaceMember(db, fred, space.id, "alice", "web");
    acceptSpaceInvite(db, alice, space.id, "web");
    setSpaceMemberRole(db, fred, space.id, alice, "admin", "web");
    expect(unread(db, fred)).toEqual(['Alice joined "Family"']);
    expect(unread(db, alice)).toEqual(['Fred made you an admin of "Family"', 'Fred invited you to "Family"']);
  });

  it("tells everyone on a list or Space but its viewers who's invited and who joins, and as what", () => {
    const { db, fred, alice, listId } = seed();
    const vic = createTestUser(db, { username: "vic", name: "Vic" });
    const bob = createTestUser(db, { username: "bob", name: "Bob" });
    inviteMember(db, fred, listId, "vic", "web", "viewer");
    acceptInvite(db, vic, listId, "web");
    for (const u of [fred, alice, vic]) markNotificationsRead(db, u);
    inviteMember(db, fred, listId, "bob", "web", "commenter");
    expect(unread(db, alice)).toEqual(['Fred invited @bob to "Home" as a commenter']);
    expect(unread(db, bob)).toEqual(['Fred invited you to "Home" as a commenter']);
    acceptInvite(db, bob, listId, "web");
    expect(unread(db, fred)).toEqual(['Bob joined "Home" as a commenter']);
    expect(unread(db, alice)[0]).toBe('Bob joined "Home" as a commenter');
    // A viewer only looks on: not even as background activity.
    const heard = (u: string) => [...unread(db, u), ...unread(db, u, true)];
    expect(heard(vic)).toEqual([]);

    // In a Space: admins, members and commenters hear; its viewers don't.
    const space = createSpace(db, fred, { name: "Family" }, "web");
    const join = (handle: string, id: string, role: "member" | "commenter" | "viewer") => {
      inviteSpaceMember(db, fred, space.id, handle, "web", role);
      acceptSpaceInvite(db, id, space.id, "web");
    };
    join("alice", alice, "member");
    join("bob", bob, "commenter");
    join("vic", vic, "viewer");
    const jo = createTestUser(db, { username: "jo", name: "Jo" });
    for (const u of [fred, alice, bob, vic]) markNotificationsRead(db, u);
    inviteSpaceMember(db, fred, space.id, "jo", "web", "viewer");
    // Through her agent, it's still Jo who joined.
    acceptSpaceInvite(db, jo, space.id, AMP);
    const told = ['Jo joined "Family" as a viewer', 'Fred invited @jo to "Family" as a viewer'];
    expect(unread(db, alice)).toEqual(told);
    expect(unread(db, bob)).toEqual(told);
    expect(unread(db, fred)).toEqual([told[0]]);
    expect(heard(vic)).toEqual([]);

    // A list in the Space: its commenters hear of a list invite; Jo, who
    // only views it through the Space, doesn't.
    setProjectSpace(db, fred, listId, space.id, "web");
    const kimId = createTestUser(db, { username: "kim", name: "Kim" });
    for (const u of [bob, jo]) markNotificationsRead(db, u);
    inviteMember(db, fred, listId, "kim", "web");
    expect(unread(db, bob)).toEqual(['Fred invited @kim to "Home"']);
    expect(heard(jo)).toEqual([]);
    // A revoked invite goes from every inbox, the invitee's too.
    removeMember(db, fred, listId, kimId, "web");
    expect(unread(db, bob)).toEqual([]);
    expect(listNotifications(db, kimId).map((n) => plainText(n.parts))).toEqual([]);
    // Once out of the Space, Bob no longer sees what happened in it.
    removeSpaceMember(db, fred, space.id, bob, "web");
    expect(unread(db, bob).filter((n) => n.includes("Family"))).toEqual([]);
  });

  it("writes nothing when the change rolls back", () => {
    const { db, fred, alice, listId } = seed();
    // One blank sub-item title rolls back the item with it.
    expect(() =>
      addItem(
        db,
        fred,
        { projectId: listId, title: "Trip", assigneeIds: [alice], subItems: ["Pack", "  "] },
        "web",
      ),
    ).toThrow();
    expect(unread(db, alice)).toEqual([]);
  });

  it("tells the people a comment mentions, and an edit only those it newly mentions", () => {
    const { db, fred, alice, listId } = seed();
    const bob = createTestUser(db, { username: "bob", name: "Bob" });
    const item = addItem(db, fred, { projectId: listId, title: "Fix tap" }, "web");
    const comment = addComment(db, fred, item.id, "@alice can you look? cc @fred", "web");
    expect(unread(db, alice)).toEqual(['Fred mentioned you on "Fix tap": @alice can you look? cc @fred']);
    expect(unread(db, fred)).toEqual([]);
    // Bob can't open the item, so mentioning him reaches nobody.
    addComment(db, fred, item.id, "@bob any idea?", "web");
    expect(unread(db, bob)).toEqual([]);
    inviteMember(db, fred, listId, "bob", "web");
    acceptInvite(db, bob, listId, "web");
    markNotificationsRead(db, bob);
    updateComment(db, fred, comment.id, "@alice can you look? cc @bob", "web");
    // Being mentioned made Alice a follower, so she heard the next comment
    // too; her mention quotes the comment as it reads now.
    expect(unread(db, alice)).toEqual([
      // On the list herself, she's told who joined it.
      'Bob joined "Home"',
      'Fred invited @bob to "Home"',
      'Fred commented on "Fix tap": @bob any idea?',
      'Fred mentioned you on "Fix tap": @alice can you look? cc @bob',
    ]);
    expect(unread(db, bob)).toEqual(['Fred mentioned you on "Fix tap": @alice can you look? cc @bob']);
  });

  it("tells people they're invited, by the name it was sent with", () => {
    const { db, fred } = seed();
    const carol = createTestUser(db, { username: "carol", name: "Carol" });
    const list = createProject(db, fred, { name: "Garden" }, "web");
    inviteMember(db, fred, list.id, "carol", "web");
    const space = createSpace(db, fred, { name: "Family" }, "web");
    inviteSpaceMember(db, fred, space.id, "carol", "web");
    // She can't see it yet, so a rename doesn't reach her.
    updateSpace(db, fred, space.id, { name: "Secret" }, "web");
    expect(listNotifications(db, carol).map((n) => [n.title, plainText(n.parts)]).sort()).toEqual([
      ["Family", 'Fred invited you to "Family"'],
      ["Garden", 'Fred invited you to "Garden"'],
    ]);
  });

  it("shows everyone on a list its activity, and pushes it only to those who asked for all of it", async () => {
    const { db, fred, alice, listId } = seed();
    const keys = {
      p256dh: Buffer.alloc(65, 4).toString("base64url"),
      auth: Buffer.alloc(16, 1).toString("base64url"),
    };
    savePushSubscription(db, alice, { endpoint: "https://web.push.apple.com/a", keys, deviceLabel: "iPhone" }, VAPID.publicKey);
    await deliverNotifications(db, due());
    sendPush.mockClear();
    const item = addItem(db, fred, { projectId: listId, title: "Fix tap" }, "web");
    updateProject(db, fred, listId, { name: "Flat" }, "web");
    await deliverNotifications(db, due());
    expect(unread(db, alice, true)).toEqual(['Fred renamed "Home" to "Flat"', 'Fred added "Fix tap" to "Flat"']);
    expect(unread(db, alice)).toEqual([]);
    expect(sendPush).not.toHaveBeenCalled();

    setNotificationLevel(db, alice, `list:${listId}`, "all");
    updateItem(db, fred, item.id, { title: "Fix the tap" }, "web");
    // Not a follower, so a rename of the item isn't hers to hear.
    addItem(db, fred, { projectId: listId, title: "Paint" }, "web");
    await deliverNotifications(db, due());
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "Flat", body: 'Fred added "Paint" to "Flat"' }),
      expect.anything(),
    );
  });

  it("uses the most specific level set: the list's, then its Space's, then everything's", () => {
    const { db, fred, alice } = seed();
    const space = createSpace(db, fred, { name: "Family" }, "web");
    inviteSpaceMember(db, fred, space.id, "alice", "web");
    acceptSpaceInvite(db, alice, space.id, "web");
    const garden = createProject(db, fred, { name: "Garden", spaceId: space.id }, "web");
    expect(unread(db, alice, true)).toContain('Fred added "Garden" to "Family"');
    markNotificationsRead(db, alice);

    setNotificationLevel(db, alice, "all", "all");
    setNotificationLevel(db, alice, `space:${space.id}`, "mine");
    const weeds = addItem(db, fred, { projectId: garden.id, title: "Weeds" }, "web");
    setFollowing(db, alice, weeds.id, true);
    completeItem(db, fred, weeds.id, "web");
    // Only for her in Family: no activity, nothing she follows.
    expect(listNotifications(db, alice).filter((n) => !n.readAt)).toEqual([]);
    // What's aimed at her still reaches her.
    addItem(db, fred, { projectId: garden.id, title: "Mow", assigneeIds: [alice] }, "web");
    expect(unread(db, alice)).toEqual(['Fred added "Mow" for you']);
    // Garden's own level beats Family's.
    setNotificationLevel(db, alice, `list:${garden.id}`, "default");
    uncompleteItem(db, fred, weeds.id, "web");
    expect(unread(db, alice)[0]).toBe('Fred reopened "Weeds"');
    // Back to Family's.
    setNotificationLevel(db, alice, `list:${garden.id}`, null);
    completeItem(db, fred, weeds.id, "web");
    expect(unread(db, alice)[0]).toBe('Fred reopened "Weeds"');
    // Only for scopes she's in.
    const bob = createTestUser(db, { username: "bob", name: "Bob" });
    expect(() => setNotificationLevel(db, bob, `list:${garden.id}`, "all")).toThrow();
    expect(() => setNotificationLevel(db, bob, `space:${space.id}`, "all")).toThrow();
  });

  it("lists ones made in the same millisecond latest first", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 10, 14, 12));
      const { db, fred, alice, listId } = seed();
      const titles = ["A", "B", "C", "D", "E", "F", "G", "H"];
      for (const title of titles) addItem(db, fred, { projectId: listId, title, assigneeIds: [alice] }, "web");
      const newestFirst = unread(db, alice);
      expect(newestFirst).toHaveLength(titles.length);
      // Each names its item, in the reverse of the order they were made.
      expect(newestFirst.map((n) => n.match(/"(.)"/)?.[1])).toEqual([...titles].reverse());
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells a list's or Space's members when it's archived, restored or deleted", () => {
    const { db, fred, alice, listId } = seed();
    updateProject(db, fred, listId, { status: "archived" }, "web");
    expect(listNotifications(db, alice)[0]).toMatchObject({ url: "/archived", reason: "member" });
    updateProject(db, fred, listId, { status: "active", name: "Flat" }, "web");
    // One notification each, for the stronger reason.
    expect(unread(db, alice)).toEqual(['Fred restored "Flat"', 'Fred archived "Flat"']);
    expect(unread(db, alice, true)).toEqual([]);
    const space = createSpace(db, fred, { name: "Family" }, "web");
    inviteSpaceMember(db, fred, space.id, "alice", "web");
    acceptSpaceInvite(db, alice, space.id, "web");
    markNotificationsRead(db, alice);
    // Gone, and she can't open either any more: by the names they had.
    deleteSpace(db, fred, space.id, "web");
    deleteProject(db, fred, listId, "web");
    expect(unread(db, alice)).toEqual(['Fred deleted "Flat"', 'Fred deleted "Family"']);
    expect(unread(db, fred)).toEqual([]);
  });

  it("pushes each notification once, to the recipient's devices on the current key", async () => {
    const { db, fred, alice, listId } = seed();
    const keys = {
      p256dh: Buffer.alloc(65, 4).toString("base64url"),
      auth: Buffer.alloc(16, 1).toString("base64url"),
    };
    const endpoint = "https://web.push.apple.com/alice-phone";
    savePushSubscription(db, alice, { endpoint, keys, deviceLabel: "iPhone" }, VAPID.publicKey);
    await deliverNotifications(db, due()); // the seed's invite
    sendPush.mockClear();

    const item = addItem(db, fred, { projectId: listId, title: "Fix tap", assigneeIds: [alice] }, "web");
    await Promise.all([deliverNotifications(db, due()), deliverNotifications(db, due())]);
    await deliverNotifications(db, due());
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledWith(
      [{ endpoint, keys }],
      {
        title: "Home",
        body: 'Fred added "Fix tap" for you',
        url: `/board?p=${listId}&item=${item.id}`,
        tag: `item:${item.id}`,
        badge: 1,
      },
      VAPID,
    );
  });

  it("waits for a burst of changes to an item to go quiet, then pushes them as one", async () => {
    const { db, fred, alice, listId } = seed();
    subscribe(db, alice);
    await deliverNotifications(db, due());
    sendPush.mockClear();
    const item = addItem(db, fred, { projectId: listId, title: "Fix tap" }, "web");
    setFollowing(db, alice, item.id, true);
    const start = Date.now();
    updateItem(db, fred, item.id, { dueDate: "2026-12-01" }, "web");
    addComment(db, fred, item.id, "On it", "web");
    completeItem(db, fred, item.id, "web");
    // Still busy: nothing yet, and it says when to look again.
    const next = await deliverNotifications(db, start + 60_000);
    expect(sendPush).not.toHaveBeenCalled();
    expect(next).toBeGreaterThanOrEqual(start + 2 * 60_000);
    await deliverNotifications(db, next ?? due());
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0]).toContainEqual(
      expect.objectContaining({ body: 'Fred made 3 changes to "Fix tap"', tag: `item:${item.id}` }),
    );
    // Something aimed at her waits only briefly.
    sendPush.mockClear();
    updateItem(db, fred, item.id, { assigneeIds: [alice] }, "web");
    await deliverNotifications(db, Date.now() + 31_000);
    expect(sendPush.mock.calls[0]).toContainEqual(
      expect.objectContaining({ body: 'Fred assigned you "Fix tap"' }),
    );
  });

  it("says when something's due in words in a push, where it can", async () => {
    const { db, fred, alice, listId } = seed();
    subscribe(db, alice);
    const item = addItem(db, fred, { projectId: listId, title: "Fix tap" }, "web");
    setFollowing(db, alice, item.id, true);
    await deliverNotifications(db, due());
    sendPush.mockClear();
    // Alice hasn't saved a time zone, so her days are UTC's.
    const weekend = weekSpan(dayOf(Date.now(), "UTC"), 0, "weekend");
    updateItem(db, fred, item.id, weekend, "web");
    await deliverNotifications(db, due());
    expect(sendPush.mock.calls[0]).toContainEqual(
      expect.objectContaining({ body: 'Fred set "Fix tap" due this weekend' }),
    );
    // A span with no word for it keeps its dates.
    sendPush.mockClear();
    updateItem(db, fred, item.id, { dueFrom: "2030-01-02", dueDate: "2030-01-04" }, "web");
    await deliverNotifications(db, due());
    expect(sendPush.mock.calls[0]).toContainEqual(
      expect.objectContaining({ body: 'Fred set "Fix tap" due 2030-01-02 to 2030-01-04' }),
    );
  });

  it("sends nothing for a change undone before it went out", async () => {
    const { db, fred, alice, listId } = seed();
    subscribe(db, alice);
    const item = addItem(db, fred, { projectId: listId, title: "Fix tap" }, "web");
    setFollowing(db, alice, item.id, true);
    await deliverNotifications(db, due());
    markNotificationsRead(db, alice);
    sendPush.mockClear();
    completeItem(db, fred, item.id, "web");
    uncompleteItem(db, fred, item.id, "web");
    updateItem(db, fred, item.id, { assigneeIds: [alice] }, "web");
    updateItem(db, fred, item.id, { assigneeIds: [] }, "web");
    await deliverNotifications(db, due());
    expect(sendPush).not.toHaveBeenCalled();
    expect(unread(db, alice)).toEqual([]);
    // Undone only as a pair: ticked twice over, it's still news.
    completeItem(db, fred, item.id, "web");
    uncompleteItem(db, fred, item.id, "web");
    completeItem(db, fred, item.id, "web");
    await deliverNotifications(db, due());
    expect(sendPush.mock.calls[0]).toContainEqual(
      expect.objectContaining({ body: 'Fred completed "Fix tap"' }),
    );
  });

  it("doesn't push to someone looking at their board, and marks it seen", async () => {
    const { db, fred, alice, listId } = seed();
    subscribe(db, alice);
    await deliverNotifications(db, due());
    sendPush.mockClear();
    const away = markLooking(alice);
    addItem(db, fred, { projectId: listId, title: "Fix tap", assigneeIds: [alice] }, "web");
    await deliverNotifications(db, due());
    expect(sendPush).not.toHaveBeenCalled();
    expect(unread(db, alice)).toEqual([]);
    expect(listNotifications(db, alice)[0].parts.map((p) => p.text).join("")).toBe('Fred added Fix tap for you');
    away();
    addItem(db, fred, { projectId: listId, title: "Paint", assigneeIds: [alice] }, "web");
    await deliverNotifications(db, due());
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("keeps a notification too old to push in the inbox only", async () => {
    const { db, fred, alice, listId } = seed();
    await deliverNotifications(db, due());
    sendPush.mockClear();
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 11 * 60_000);
    addItem(db, fred, { projectId: listId, title: "Old news", assigneeIds: [alice] }, "web");
    now.mockRestore();
    await deliverNotifications(db, due());
    expect(sendPush).not.toHaveBeenCalled();
    expect(unread(db, alice)).toContain('Fred added "Old news" for you');
  });
});
