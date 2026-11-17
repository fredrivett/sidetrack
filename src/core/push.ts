import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./db";
import { pushSubscriptions } from "./schema";

// The devices a user gets push notifications on (Settings → Notifications).
// Not audited, like sessions: a subscription is where to deliver, on one
// device, and changes nothing anyone else sees.

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

function assertEndpoint(endpoint: unknown): void {
  if (typeof endpoint !== "string") throw new Error("invalid push endpoint");
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
 * Turn push on for a device. The endpoint names the browser install, so a
 * device that subscribes again, perhaps after someone else signed in on it,
 * moves to whoever subscribed last.
 */
// audit-exempt: delivery state for one device, like a session.
export function savePushSubscription(
  db: Db,
  userId: string,
  input: PushSubscriptionInput,
): void {
  assertEndpoint(input.endpoint);
  // From the browser, through a Server Action, so check the types too.
  const { p256dh, auth } = input.keys ?? {};
  if (typeof p256dh !== "string" || typeof auth !== "string" || !p256dh || !auth) {
    throw new Error("invalid push subscription keys");
  }
  const label = typeof input.deviceLabel === "string" ? input.deviceLabel.trim() : "";
  const row = {
    userId,
    p256dh,
    auth,
    deviceLabel: label.slice(0, 60) || "Device",
    createdAt: Date.now(),
  };
  db.insert(pushSubscriptions)
    .values({ endpoint: input.endpoint, ...row })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row })
    .run();
}

/** The user's devices with push on, oldest first. */
export function listPushDevices(db: Db, userId: string): PushDevice[] {
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      deviceLabel: pushSubscriptions.deviceLabel,
      createdAt: pushSubscriptions.createdAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(pushSubscriptions.createdAt)
    .all();
}

/** Where to send the user's pushes: each device's endpoint and keys. */
export function pushTargets(db: Db, userId: string) {
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      keys: { p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth },
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
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
