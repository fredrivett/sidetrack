import { and, count, eq, inArray, ne } from "drizzle-orm";
import { isBase64urlBytes } from "../lib/push";
import type { Db } from "./db";
import { pushSubscriptions } from "./schema";

// The devices a user gets push notifications on (Settings → Notifications).
// Not audited, like sessions: a subscription is where to deliver, on one
// device. Saving an endpoint another user holds moves that device to the
// user saving it (see savePushSubscription).

/** A device's Web Push subscription, as the browser's PushSubscription.toJSON() gives it. */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceLabel: string;
}

/** A device with push on, as Settings lists it. */
export interface PushDevice {
  endpoint: string;
  deviceLabel: string;
  createdAt: number;
}

// The push services browsers subscribe through. The server posts to the
// endpoint, so one anywhere else would let anyone make it send requests to
// a host of their choosing.
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
];

/** Enough for every device someone uses, and a bound on what one test sends. */
export const MAX_PUSH_DEVICES = 20;

function assertEndpoint(endpoint: unknown): void {
  // Real endpoints are a few hundred characters.
  if (typeof endpoint !== "string" || endpoint.length > 2048) {
    throw new Error("invalid push endpoint");
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("invalid push endpoint");
  }
  if (url.protocol !== "https:" || !PUSH_HOSTS.some((host) => host.test(url.hostname))) {
    throw new Error("invalid push endpoint");
  }
}

/**
 * Turn push on for a device, subscribed with the server's VAPID public key
 * `vapidKey`. The endpoint names the browser install, so a device that
 * subscribes again, perhaps after someone else signed in on it, moves to
 * whoever subscribed last. The user's subscriptions made with an older key
 * can never be delivered to again, so they go.
 */
// audit-exempt: delivery state for one device, like a session.
export function savePushSubscription(
  db: Db,
  userId: string,
  input: PushSubscriptionInput,
  vapidKey: string,
): void {
  assertEndpoint(input.endpoint);
  // From the browser, through a Server Action, so check the types too: a
  // P-256 public key (65 bytes) and a 16-byte auth secret.
  const { p256dh, auth } = input.keys ?? {};
  if (!isBase64urlBytes(p256dh, 65) || !isBase64urlBytes(auth, 16)) {
    throw new Error("invalid push subscription keys");
  }
  const label = typeof input.deviceLabel === "string" ? input.deviceLabel.trim() : "";
  const row = {
    userId,
    p256dh,
    auth,
    vapidKey,
    deviceLabel: label.slice(0, 60) || "Device",
    createdAt: Date.now(),
  };
  // Not a transaction, which the audit lint keeps for audited writes: these
  // run back to back with no await, so nothing else runs between them.
  db.delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), ne(pushSubscriptions.vapidKey, vapidKey)))
    .run();
  const [{ n }] = db
    .select({ n: count() })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), ne(pushSubscriptions.endpoint, input.endpoint)))
    .all();
  if (n >= MAX_PUSH_DEVICES) {
    throw new Error(`push is on for ${MAX_PUSH_DEVICES} devices already; remove one first`);
  }
  db.insert(pushSubscriptions)
    .values({ endpoint: input.endpoint, ...row })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row })
    .run();
}

/** The user's devices with push on under the current key, oldest first. */
export function listPushDevices(db: Db, userId: string, vapidKey: string): PushDevice[] {
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      deviceLabel: pushSubscriptions.deviceLabel,
      createdAt: pushSubscriptions.createdAt,
    })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.vapidKey, vapidKey)))
    .orderBy(pushSubscriptions.createdAt, pushSubscriptions.endpoint)
    .all();
}

/** Where to send the user's pushes: each device's endpoint and keys, under the current key. */
export function pushTargets(db: Db, userId: string, vapidKey: string) {
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      keys: { p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth },
    })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.vapidKey, vapidKey)))
    .all();
}

/** Turn push off for one of the user's devices. */
// audit-exempt: delivery state for one device, like a session.
export function removePushSubscription(db: Db, userId: string, endpoint: string): void {
  db.delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .run();
}

/** Drop subscriptions the push service says are gone (the app was removed, or permission revoked). */
// audit-exempt: cleaning up delivery state nobody can use.
export function forgetPushSubscriptions(db: Db, endpoints: string[]): void {
  if (endpoints.length === 0) return;
  db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, endpoints)).run();
}
