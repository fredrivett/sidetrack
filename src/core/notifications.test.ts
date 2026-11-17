import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { createProject, updateProject } from "./projects";
import { savePushSubscription } from "./push";
import {
  acceptSpaceInvite,
  createSpace,
  inviteSpaceMember,
  setSpaceMemberRole,
  updateSpace,
} from "./spaces";
import { createTestDb, createTestUser } from "./test-helpers";

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

beforeEach(() => sendPush.mockClear());

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
      url: `/?p=${listId}&item=${item.id}`,
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
    expect(unread(db, fred).sort()).toEqual([
      'Amp assigned you "Ship it"',
      'Amp finished work on "Ship it": Merged #12',
    ]);
    const finished = listNotifications(db, fred).find((n) => n.reason === "agent-finished");
    expect(finished).toMatchObject({
      parts: [
        { text: "Amp", em: "person" },
        { text: " finished work on " },
        { text: "Ship it", em: "item", quote: true },
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

  it("tells only the assignees when a repeating item comes round again", () => {
    const { db, fred, alice, listId } = seed();
    // Fred created it, so he follows it; it's Alice's to do.
    const bins = addItem(
      db,
      fred,
      { projectId: listId, title: "Bins", assigneeIds: [alice], repeat: { every: 1, unit: "day" } },
      "web",
    );
    completeItem(db, alice, bins.id, "web");
    markNotificationsRead(db, alice);
    markNotificationsRead(db, fred);
    reopenDueRepeats(db, fred, { timeZone: "UTC", now: Date.now() + 2 * 86_400_000 });
    expect(unread(db, alice)).toEqual(['"Bins" is due again']);
    expect(unread(db, fred)).toEqual([]);
    // Reopened by hand, it's news to its followers again.
    completeItem(db, alice, bins.id, "web");
    uncompleteItem(db, alice, bins.id, "web");
    expect(unread(db, fred)).toEqual(['Alice reopened "Bins"', 'Alice completed "Bins"']);
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
    await deliverNotifications(db);
    sendPush.mockClear();
    const item = addItem(db, fred, { projectId: listId, title: "Fix tap" }, "web");
    updateProject(db, fred, listId, { name: "Flat" }, "web");
    await deliverNotifications(db);
    expect(unread(db, alice, true)).toEqual(['Fred renamed "Home" to "Flat"', 'Fred added "Fix tap" to "Flat"']);
    expect(unread(db, alice)).toEqual([]);
    expect(sendPush).not.toHaveBeenCalled();

    setNotificationLevel(db, alice, `list:${listId}`, "all");
    updateItem(db, fred, item.id, { title: "Fix the tap" }, "web");
    // Not a follower, so a rename of the item isn't hers to hear.
    addItem(db, fred, { projectId: listId, title: "Paint" }, "web");
    await deliverNotifications(db);
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

  it("pushes each notification once, to the recipient's devices on the current key", async () => {
    const { db, fred, alice, listId } = seed();
    const keys = {
      p256dh: Buffer.alloc(65, 4).toString("base64url"),
      auth: Buffer.alloc(16, 1).toString("base64url"),
    };
    const endpoint = "https://web.push.apple.com/alice-phone";
    savePushSubscription(db, alice, { endpoint, keys, deviceLabel: "iPhone" }, VAPID.publicKey);
    await deliverNotifications(db); // the seed's invite
    sendPush.mockClear();

    const item = addItem(db, fred, { projectId: listId, title: "Fix tap", assigneeIds: [alice] }, "web");
    await Promise.all([deliverNotifications(db), deliverNotifications(db)]);
    await deliverNotifications(db);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledWith(
      [{ endpoint, keys }],
      {
        title: "Home",
        body: 'Fred added "Fix tap" for you',
        url: `/?p=${listId}&item=${item.id}`,
        tag: `item:${item.id}`,
      },
      VAPID,
    );
  });

  it("keeps a notification too old to push in the inbox only", async () => {
    const { db, fred, alice, listId } = seed();
    await deliverNotifications(db);
    sendPush.mockClear();
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 11 * 60_000);
    addItem(db, fred, { projectId: listId, title: "Old news", assigneeIds: [alice] }, "web");
    now.mockRestore();
    await deliverNotifications(db);
    expect(sendPush).not.toHaveBeenCalled();
    expect(unread(db, alice)).toContain('Fred added "Old news" for you');
  });
});
