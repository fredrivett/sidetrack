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
import { inviteMember } from "./members";
import { createProject } from "./projects";
import { pushSubscriptions } from "./schema";
import { createSpace, inviteSpaceMember } from "./spaces";
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
    expect(state.queue).toEqual(["lists", "iphone", "mac", "share", "agent"]);
    expect(state.collapsed).toBe(false);
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

  it("ticks share once the user sends an invite, not when they receive one", () => {
    const { db, fred, alice } = setup();
    const theirs = createProject(db, alice, { name: "Theirs" }, "web");
    inviteMember(db, alice, theirs.id, "fred", "web");
    expect(getGetStarted(db, fred).done.share).toBe(false);
    expect(getGetStarted(db, alice).done.share).toBe(true);

    const space = createSpace(db, fred, { name: "Household" }, "web").id;
    inviteSpaceMember(db, fred, space, "alice", "web");
    expect(getGetStarted(db, fred).done.share).toBe(true);
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

  it("counts an iPhone or iPad push device as installed on iOS, not other devices", () => {
    const { db, fred } = setup();
    addPushDevice(db, fred, "Chrome on Mac");
    expect(getGetStarted(db, fred).done.iphone).toBe(false);
    expect(getGetStarted(db, fred).done.mac).toBe(false);
    addPushDevice(db, fred, "iPad");
    expect(getGetStarted(db, fred).done.iphone).toBe(true);
  });
});

describe("recordInstall", () => {
  it("ticks only its platform and records it once", () => {
    const { db, fred, alice } = setup();
    recordInstall(db, fred, "macos", "web");
    recordInstall(db, fred, "macos", "web");
    const state = getGetStarted(db, fred);
    expect(state.done.mac).toBe(true);
    expect(state.done.iphone).toBe(false);
    expect(getGetStarted(db, alice).done.mac).toBe(false);
    const rows = listAudit(db, fred).filter((e) => e.event?.type === "profile.installed");
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toBe("added Sidetrack to a Mac's Dock");

    recordInstall(db, fred, "ios", "web");
    expect(getGetStarted(db, fred).done.iphone).toBe(true);
  });

  it("rejects anything but iOS and macOS", () => {
    const { db, fred } = setup();
    expect(() => recordInstall(db, fred, "windows" as "ios", "web")).toThrow();
  });
});

describe("the stack's view state", () => {
  it("puts cards sent to the back after the rest, in the order they went", () => {
    const { db, fred } = setup();
    sendGetStartedToBack(db, fred, "iphone");
    sendGetStartedToBack(db, fred, "lists");
    expect(getGetStarted(db, fred).queue).toEqual(["mac", "share", "agent", "iphone", "lists"]);
    // Sending one back again moves it behind the other.
    sendGetStartedToBack(db, fred, "iphone");
    expect(getGetStarted(db, fred).queue).toEqual(["mac", "share", "agent", "lists", "iphone"]);
    // A card that's done leaves the queue wherever it was.
    recordInstall(db, fred, "ios", "web");
    expect(getGetStarted(db, fred).queue).toEqual(["mac", "share", "agent", "lists"]);
  });

  it("keeps collapsed separately from the order", () => {
    const { db, fred } = setup();
    sendGetStartedToBack(db, fred, "mac");
    setGetStartedCollapsed(db, fred, true);
    const state = getGetStarted(db, fred);
    expect(state.collapsed).toBe(true);
    expect(state.queue.at(-1)).toBe("mac");
  });

  it("reads a damaged saved state as untouched", () => {
    const { db, fred } = setup();
    db.update(users)
      .set({ getStarted: { later: ["nope", 3, "share"], collapsed: "yes" } })
      .where(eq(users.id, fred))
      .run();
    const state = getGetStarted(db, fred);
    expect(state.queue).toEqual(["lists", "iphone", "mac", "agent", "share"]);
    expect(state.collapsed).toBe(false);
  });
});
