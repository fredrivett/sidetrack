import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApiKey, revokeApiKey, verifyApiKey } from "./api-keys";
import { listAudit } from "./audit";
import { users } from "./auth-schema";
import {
  getGetStarted,
  recordInstall,
  sendGetStartedToBack,
  setGetStartedCollapsed,
} from "./getStarted";
import { addItem } from "./items";
import { acceptInvite, inviteMember } from "./members";
import { createProject } from "./projects";
import { pushSubscriptions } from "./schema";
import { acceptSpaceInvite, createSpace, inviteSpaceMember } from "./spaces";
import { createTestDb, createTestUser } from "./test-helpers";

function setup() {
  const { db } = createTestDb();
  const fred = createTestUser(db, { username: "fred" });
  const alice = createTestUser(db, { username: "alice" });
  return { db, fred, alice };
}

function addPushDevice(db: ReturnType<typeof setup>["db"], userId: string, deviceLabel: string) {
  db.insert(pushSubscriptions)
    .values({
      endpoint: `https://push.example/${deviceLabel}`,
      userId,
      p256dh: "k",
      auth: "a",
      vapidKey: "v",
      deviceLabel,
      createdAt: Date.now(),
    })
    .run();
}

describe("getGetStarted", () => {
  it("starts with every step open, in order", () => {
    const { db, fred } = setup();
    const state = getGetStarted(db, fred);
    expect(Object.values(state.done).some(Boolean)).toBe(false);
    // Dates and labels wait for a list to put items in; repeat waits for a date.
    expect(state.steps).toEqual(["lists", "phone", "notifications", "computer", "share", "secure", "agent"]);
    expect(state.queue).toEqual(state.steps);
    expect(state.collapsed).toBe(false);
  });

  it("offers dates and labels once the user has a list of their own, in their place", () => {
    const { db, fred, alice } = setup();
    // A list shared with fred doesn't count: it isn't one he set up.
    const theirs = createProject(db, alice, { name: "Theirs" }, "web");
    inviteMember(db, alice, theirs.id, "fred", "web");
    acceptInvite(db, fred, theirs.id, "web");
    expect(getGetStarted(db, fred).steps).not.toContain("date");
    createProject(db, fred, { name: "Home" }, "web");
    expect(getGetStarted(db, fred).queue.slice(0, 3)).toEqual(["date", "label", "phone"]);
  });

  it("offers repeat once something has a date, and ticks each from the user's own items", () => {
    const { db, fred, alice } = setup();
    // Dated and repeating items on a list fred was only invited to aren't his doing.
    const theirs = createProject(db, alice, { name: "Theirs" }, "web");
    inviteMember(db, alice, theirs.id, "fred", "web");
    acceptInvite(db, fred, theirs.id, "web");
    addItem(db, alice, { projectId: theirs.id, title: "Bins", dueDate: "2026-11-23", repeat: { every: 1, unit: "week" } }, "web");
    expect(getGetStarted(db, fred).done.date).toBe(false);
    expect(getGetStarted(db, fred).steps).not.toContain("repeat");

    const home = createProject(db, fred, { name: "Home" }, "web");
    addItem(db, fred, { projectId: home.id, title: "Dentist", dueDate: "2026-11-24" }, "web");
    let state = getGetStarted(db, fred);
    expect(state.done.date).toBe(true);
    expect(state.done.repeat).toBe(false);
    // It takes the place it has in the order, ahead of the devices.
    expect(state.queue.slice(0, 3)).toEqual(["repeat", "label", "phone"]);

    addItem(db, fred, { projectId: home.id, title: "Rent", repeat: { every: 1, unit: "month" } }, "web");
    state = getGetStarted(db, fred);
    expect(state.done.repeat).toBe(true);
    expect(state.steps).toContain("repeat");
  });

  it("ticks label from a labelled item or a label made in one of the user's lists", () => {
    const { db, fred, alice } = setup();
    const theirs = createProject(db, alice, { name: "Theirs" }, "web");
    addItem(db, alice, { projectId: theirs.id, title: "Call the bank", labels: ["calls"] }, "web");
    const home = createProject(db, fred, { name: "Home" }, "web");
    addItem(db, fred, { projectId: home.id, title: "Unlabelled" }, "web");
    expect(getGetStarted(db, fred).done.label).toBe(false);
    expect(getGetStarted(db, alice).done.label).toBe(true);
    addItem(db, fred, { projectId: home.id, title: "Post a parcel", labels: ["errands"] }, "web");
    expect(getGetStarted(db, fred).done.label).toBe(true);
  });

  it("ticks notifications on any device, and leaves them out where the server can't send them", () => {
    const { db, fred } = setup();
    expect(getGetStarted(db, fred, { push: false }).steps).not.toContain("notifications");
    addPushDevice(db, fred, "Chrome on Mac");
    expect(getGetStarted(db, fred).done.notifications).toBe(true);
  });

  it("ticks securing the account while two-factor sign-in is on", () => {
    const { db, fred } = setup();
    expect(getGetStarted(db, fred).done.secure).toBe(false);
    db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, fred)).run();
    expect(getGetStarted(db, fred).done.secure).toBe(true);
    expect(getGetStarted(db, fred).queue).not.toContain("secure");
    db.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, fred)).run();
    expect(getGetStarted(db, fred).done.secure).toBe(false);
  });

  it("ticks lists from the user's first list of their own", () => {
    const { db, fred, alice } = setup();
    // A list shared with fred isn't one he set up.
    const theirs = createProject(db, alice, { name: "Theirs" }, "web");
    inviteMember(db, alice, theirs.id, "fred", "web");
    acceptInvite(db, fred, theirs.id, "web");
    expect(getGetStarted(db, fred).done.lists).toBe(false);
    createProject(db, fred, { name: "Home" }, "web");
    expect(getGetStarted(db, fred).done.lists).toBe(true);
    expect(getGetStarted(db, fred).queue).not.toContain("lists");
  });

  it("ticks share once someone accepts a list invite, for both of them", () => {
    const { db, fred, alice } = setup();
    const list = createProject(db, alice, { name: "Groceries" }, "web");
    inviteMember(db, alice, list.id, "fred", "web");
    expect(getGetStarted(db, alice).done.share).toBe(false);
    expect(getGetStarted(db, alice).pendingInvites).toEqual(["@fred"]);
    // Fred was invited, not inviting: nobody's waiting on him.
    expect(getGetStarted(db, fred).done.share).toBe(false);
    expect(getGetStarted(db, fred).pendingInvites).toEqual([]);

    acceptInvite(db, fred, list.id, "web");
    expect(getGetStarted(db, alice).done.share).toBe(true);
    expect(getGetStarted(db, fred).done.share).toBe(true);
    expect(getGetStarted(db, alice).pendingInvites).toEqual([]);
  });

  it("ticks share once someone joins a Space, for both of them", () => {
    const { db, fred, alice } = setup();
    // Alone in a Space isn't sharing.
    const space = createSpace(db, fred, { name: "Household" }, "web").id;
    expect(getGetStarted(db, fred).done.share).toBe(false);
    inviteSpaceMember(db, fred, space, "alice", "web");
    expect(getGetStarted(db, fred).done.share).toBe(false);
    expect(getGetStarted(db, fred).pendingInvites).toEqual(["@alice"]);

    acceptSpaceInvite(db, alice, space, "web");
    expect(getGetStarted(db, fred).done.share).toBe(true);
    expect(getGetStarted(db, alice).done.share).toBe(true);
  });

  it("ticks agent once a key is used, and keeps it after the key is revoked", () => {
    const { db, fred } = setup();
    const { record, plaintext } = createApiKey(db, fred, "Claude", "web");
    expect(getGetStarted(db, fred).done.agent).toBe(false);
    verifyApiKey(db, plaintext);
    expect(getGetStarted(db, fred).done.agent).toBe(true);

    const p = createProject(db, fred, { name: "Home" }, "web");
    addItem(
      db,
      fred,
      { projectId: p.id, title: "From the agent" },
      { source: "mcp", agent: { keyId: record.id, name: "Claude" } },
    );
    revokeApiKey(db, fred, record.id, "web");
    expect(getGetStarted(db, fred).done.agent).toBe(true);
  });

  it("counts an iPhone or iPad push device as on the Home Screen, not an Android or desktop one", () => {
    const { db, fred } = setup();
    addPushDevice(db, fred, "Chrome on Mac");
    // Android sends push to the browser, installed or not.
    addPushDevice(db, fred, "Chrome on Android");
    expect(getGetStarted(db, fred).done.phone).toBe(false);
    expect(getGetStarted(db, fred).done.computer).toBe(false);
    addPushDevice(db, fred, "iPad");
    expect(getGetStarted(db, fred).done.phone).toBe(true);
  });
});

describe("recordInstall", () => {
  it("ticks only its platform and records it once", () => {
    const { db, fred, alice } = setup();
    recordInstall(db, fred, "computer", "web");
    recordInstall(db, fred, "computer", "web");
    const state = getGetStarted(db, fred);
    expect(state.done.computer).toBe(true);
    expect(state.done.phone).toBe(false);
    expect(getGetStarted(db, alice).done.computer).toBe(false);
    const rows = listAudit(db, fred).filter((e) => e.event?.type === "profile.installed");
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toBe("installed Sidetrack on a computer");

    recordInstall(db, fred, "phone", "web");
    expect(getGetStarted(db, fred).done.phone).toBe(true);
  });

  it("rejects anything but iOS and macOS", () => {
    const { db, fred } = setup();
    expect(() => recordInstall(db, fred, "windows" as "phone", "web")).toThrow();
  });
});

describe("the stack's view state", () => {
  it("puts cards sent to the back after the rest, in the order they went", () => {
    const { db, fred } = setup();
    sendGetStartedToBack(db, fred, "phone");
    sendGetStartedToBack(db, fred, "lists");
    const rest = ["notifications", "computer", "share", "secure", "agent"];
    expect(getGetStarted(db, fred).queue).toEqual([...rest, "phone", "lists"]);
    // Sending one back again moves it behind the other.
    sendGetStartedToBack(db, fred, "phone");
    expect(getGetStarted(db, fred).queue).toEqual([...rest, "lists", "phone"]);
    // A card that's done leaves the queue wherever it was.
    recordInstall(db, fred, "phone", "web");
    expect(getGetStarted(db, fred).queue).toEqual([...rest, "lists"]);
  });

  it("keeps collapsed separately from the order", () => {
    const { db, fred } = setup();
    sendGetStartedToBack(db, fred, "computer");
    setGetStartedCollapsed(db, fred, true);
    const state = getGetStarted(db, fred);
    expect(state.collapsed).toBe(true);
    expect(state.queue.at(-1)).toBe("computer");
  });

  it("reads a damaged saved state as untouched", () => {
    const { db, fred } = setup();
    db.update(users)
      .set({ getStarted: { later: ["nope", 3, "share"], collapsed: "yes" } })
      .where(eq(users.id, fred))
      .run();
    const state = getGetStarted(db, fred);
    expect(state.queue).toEqual(["lists", "phone", "notifications", "computer", "secure", "agent", "share"]);
    expect(state.collapsed).toBe(false);
  });
});
