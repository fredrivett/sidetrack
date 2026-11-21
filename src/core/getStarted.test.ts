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
    expect(state.queue).toEqual(["lists", "phone", "computer", "share", "secure", "agent"]);
    expect(state.collapsed).toBe(false);
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

  it("counts lists the user owns, from two", () => {
    const { db, fred, alice } = setup();
    createProject(db, fred, { name: "Home" }, "web");
    // A list shared with fred isn't one he set up.
    const theirs = createProject(db, alice, { name: "Theirs" }, "web");
    inviteMember(db, alice, theirs.id, "fred", "web");
    expect(getGetStarted(db, fred).done.lists).toBe(false);
    createProject(db, fred, { name: "Work" }, "web");
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
    expect(getGetStarted(db, fred).queue).toEqual(["computer", "share", "secure", "agent", "phone", "lists"]);
    // Sending one back again moves it behind the other.
    sendGetStartedToBack(db, fred, "phone");
    expect(getGetStarted(db, fred).queue).toEqual(["computer", "share", "secure", "agent", "lists", "phone"]);
    // A card that's done leaves the queue wherever it was.
    recordInstall(db, fred, "phone", "web");
    expect(getGetStarted(db, fred).queue).toEqual(["computer", "share", "secure", "agent", "lists"]);
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
    expect(state.queue).toEqual(["lists", "phone", "computer", "secure", "agent", "share"]);
    expect(state.collapsed).toBe(false);
  });
});
