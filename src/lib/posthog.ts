import { PostHog } from "posthog-node";

let client: PostHog | null = null;

/**
 * Server-side PostHog client, or `null` when error tracking is not configured.
 *
 * Capture is opt-in. With no `POSTHOG_KEY` in the environment this returns
 * `null` and every caller becomes a no-op. The key is read at runtime — it is
 * deliberately NOT a `NEXT_PUBLIC_` build-time inline — so it can never be
 * baked into a published image or client bundle. A self-hoster who sets no key
 * of their own sends nothing, anywhere.
 */
export function getPostHog(): PostHog | null {
  const key = process.env.POSTHOG_KEY;
  if (!key) return null;
  if (!client) {
    client = new PostHog(key, {
      host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
      // Single-instance, long-lived server, but it can be restarted between
      // requests — flush each event immediately rather than batching.
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}
