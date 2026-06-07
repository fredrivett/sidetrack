import posthog from "posthog-js";

// Client-side capture: pageviews, autocapture, and unhandled errors.
//
// Opt-in. With NEXT_PUBLIC_POSTHOG_KEY unset, posthog is never initialized and
// every capture call is a no-op — nothing is sent anywhere. Unlike the
// server-side key, this one is a NEXT_PUBLIC_ var, so it is INLINED INTO THE
// CLIENT BUNDLE at build time. A build from source without the var ships zero
// analytics; never bake it into a published image (see README).
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (key) {
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    defaults: "2026-01-30",
  });
}
