import webpush, { WebPushError } from "web-push";
import { getPostHog } from "./posthog";

// Sends Web Push notifications. public/sw.js shows each one and opens `url`
// when it's tapped.

/** Whether `value` is base64url (unpadded, as Web Push writes it) of exactly `bytes` bytes. */
export function isBase64urlBytes(value: unknown, bytes: number): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]+$/.test(value) &&
    Buffer.from(value, "base64url").length === bytes
  );
}

/** What a notification says, and where tapping it goes. */
export interface PushMessage {
  title: string;
  body: string;
  /** A path in the app, such as "/". */
  url: string;
  /** Notifications with the same tag replace each other instead of stacking. */
  tag?: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Sends the message to every target, and returns the endpoints the push
 * service says are gone (404 or 410), for the caller to forget. Other
 * failures are reported to PostHog and skipped: a push is best-effort, and one device
 * failing shouldn't stop the rest.
 */
export async function sendPush(
  targets: PushTarget[],
  message: PushMessage,
  vapid: Vapid,
): Promise<{ sent: number; gone: string[] }> {
  const payload = JSON.stringify(message);
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    targets.map(async (target) => {
      try {
        await webpush.sendNotification(target, payload, {
          vapidDetails: vapid,
          // Worth delivering for a day to a phone that's off; after that it's stale.
          TTL: 24 * 60 * 60,
          // A push service that stalls mustn't hold up the rest, or whoever's waiting.
          timeout: 10_000,
        });
        sent++;
      } catch (error) {
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
          gone.push(target.endpoint);
        } else {
          getPostHog()?.captureException(error);
        }
      }
    }),
  );
  return { sent, gone };
}
