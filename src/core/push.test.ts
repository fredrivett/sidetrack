import { describe, expect, it } from "vitest";
import {
  MAX_PUSH_DEVICES,
  forgetPushSubscriptions,
  listPushDevices,
  pushTargets,
  removePushSubscription,
  savePushSubscription,
} from "./push";
import { createTestDb, createTestUser } from "./test-helpers";

const APPLE = "https://web.push.apple.com/QGuN0p_example";
const VAPID = "server-key-1";
const key = (bytes: number, fill: number) => Buffer.alloc(bytes, fill).toString("base64url");
const keys = { p256dh: key(65, 4), auth: key(16, 1) };
const device = (endpoint: string) => ({ endpoint, keys, deviceLabel: "iPhone" });

describe("push subscriptions", () => {
  it("moves a device to whoever subscribed on it last", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db);
    const bob = createTestUser(db);
    savePushSubscription(db, alice, device(APPLE), VAPID);
    const bobKeys = { p256dh: key(65, 9), auth: key(16, 9) };
    savePushSubscription(db, bob, { endpoint: APPLE, keys: bobKeys, deviceLabel: "iPhone" }, VAPID);
    expect(listPushDevices(db, alice, VAPID)).toEqual([]);
    expect(pushTargets(db, bob, VAPID)).toEqual([{ endpoint: APPLE, keys: bobKeys }]);
  });

  it("refuses an endpoint that isn't a push service, so the server can't be sent elsewhere", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db);
    for (const endpoint of [
      "http://web.push.apple.com/x",
      "https://web.push.apple.com.evil.example/x",
      "https://localhost:3000/x",
      "https://169.254.169.254/latest",
      `https://web.push.apple.com/${"x".repeat(3000)}`,
    ]) {
      expect(() => savePushSubscription(db, alice, device(endpoint), VAPID)).toThrow(
        /invalid push endpoint/,
      );
    }
    // Windows' push service gives each install its own subdomain.
    savePushSubscription(db, alice, device("https://db5p.notify.windows.com/w/?token=abc"), VAPID);
    expect(listPushDevices(db, alice, VAPID)).toHaveLength(1);
  });

  it("refuses keys that couldn't encrypt a push", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db);
    for (const bad of [
      { p256dh: key(64, 4), auth: keys.auth },
      { p256dh: keys.p256dh, auth: key(15, 1) },
      { p256dh: `${keys.p256dh}=`, auth: keys.auth },
    ]) {
      expect(() =>
        savePushSubscription(db, alice, { endpoint: APPLE, keys: bad, deviceLabel: "x" }, VAPID),
      ).toThrow(/invalid push subscription keys/);
    }
  });

  it("drops a user's devices subscribed with an old server key once they subscribe with the new one", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db);
    savePushSubscription(db, alice, device(`${APPLE}-old`), "server-key-0");
    expect(pushTargets(db, alice, VAPID)).toEqual([]);
    savePushSubscription(db, alice, device(APPLE), VAPID);
    expect(listPushDevices(db, alice, "server-key-0")).toEqual([]);
    expect(listPushDevices(db, alice, VAPID).map((d) => d.endpoint)).toEqual([APPLE]);
  });

  it("caps each user's devices, but lets one already on save again", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db);
    for (let i = 0; i < MAX_PUSH_DEVICES; i++) savePushSubscription(db, alice, device(`${APPLE}${i}`), VAPID);
    expect(() => savePushSubscription(db, alice, device(`${APPLE}-more`), VAPID)).toThrow(/remove one/);
    savePushSubscription(db, alice, device(`${APPLE}0`), VAPID);
    expect(listPushDevices(db, alice, VAPID)).toHaveLength(MAX_PUSH_DEVICES);
  });

  it("removes only the user's own device, and forgets gone ones whoever has them", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db);
    const bob = createTestUser(db);
    savePushSubscription(db, alice, device(APPLE), VAPID);
    savePushSubscription(db, bob, device(`${APPLE}-bob`), VAPID);
    removePushSubscription(db, bob, APPLE);
    expect(listPushDevices(db, alice, VAPID)).toHaveLength(1);
    forgetPushSubscriptions(db, [APPLE, `${APPLE}-bob`]);
    expect(listPushDevices(db, alice, VAPID)).toEqual([]);
    expect(listPushDevices(db, bob, VAPID)).toEqual([]);
  });
});
