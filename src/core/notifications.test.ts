import { beforeEach, describe, expect, it, vi } from "vitest";
import { finishWork, startWork } from "./agentSessions";
import { addComment, updateComment } from "./comments";
import { plainText } from "./describe";
import { addItem, updateItem } from "./items";
import { acceptInvite, inviteMember, removeMember } from "./members";
import { deliverNotifications, listNotifications, markNotificationsRead } from "./notifications";
import { createProject, updateProject } from "./projects";
import { savePushSubscription } from "./push";
import { createSpace, inviteSpaceMember, updateSpace } from "./spaces";
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
  markNotificationsRead(db, alice);
  return { db, fred, alice, listId: list.id };
}

/** What's unread in the user's inbox, as a push would say it. */
const unread = (db: ReturnType<typeof seed>["db"], userId: string) =>
  listNotifications(db, userId).flatMap((n) =>
    n.readAt === null ? [plainText(n.parts) + (n.snippet ? `: ${n.snippet}` : "")] : [],
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
    // Alice's one quotes the comment as it reads now.
    expect(unread(db, alice)).toEqual(['Fred mentioned you on "Fix tap": @alice can you look? cc @bob']);
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
