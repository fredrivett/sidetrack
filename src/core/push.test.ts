import { describe, expect, it } from "vitest";
import { listPushDevices, pushTargets, savePushSubscription } from "./push";
import { createTestDb, createTestUser } from "./test-helpers";

const APPLE = "https://web.push.apple.com/QGuN0p_example";
const keys = { p256dh: "BNc-key", auth: "auth-secret" };

describe("push subscriptions", () => {
  it("moves a device to whoever subscribed on it last", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db);
    const bob = createTestUser(db);
    savePushSubscription(db, alice, { endpoint: APPLE, keys, deviceLabel: "iPhone" });
    savePushSubscription(db, bob, {
      endpoint: APPLE,
      keys: { p256dh: "new-key", auth: "new-auth" },
      deviceLabel: "iPhone",
    });
    expect(listPushDevices(db, alice)).toEqual([]);
    expect(pushTargets(db, bob)).toEqual([
      { endpoint: APPLE, keys: { p256dh: "new-key", auth: "new-auth" } },
    ]);
  });

  it("refuses an endpoint that isn't a push service, so the server can't be sent elsewhere", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db);
    for (const endpoint of [
      "http://web.push.apple.com/x",
      "https://web.push.apple.com.evil.example/x",
      "https://localhost:3000/x",
      "https://169.254.169.254/latest",
    ]) {
      expect(() => savePushSubscription(db, alice, { endpoint, keys, deviceLabel: "x" })).toThrow(
        /invalid push endpoint/,
      );
    }
    // Windows' push service gives each install its own subdomain.
    savePushSubscription(db, alice, {
      endpoint: "https://db5p.notify.windows.com/w/?token=abc",
      keys,
      deviceLabel: "Edge on Windows",
    });
    expect(listPushDevices(db, alice)).toHaveLength(1);
  });
});
