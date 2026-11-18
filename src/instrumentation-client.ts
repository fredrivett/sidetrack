import posthog from "posthog-js";
import { RELEASE } from "./lib/release";
import { maskReplayAttributes } from "./lib/replayPrivacy";

// Client-side capture: pageviews, autocapture, and unhandled errors.
//
// Opt-in. With NEXT_PUBLIC_POSTHOG_KEY unset, posthog is never initialized and
// every capture call is a no-op — nothing is sent anywhere. Unlike the
// server-side key, this one is a NEXT_PUBLIC_ var, so it is INLINED INTO THE
// CLIENT BUNDLE at build time. A build from source without the var ships zero
// analytics; never bake it into a published image (see docs/self-hosting.md).
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (key) {
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    defaults: "2026-01-30",
    // People's lists are private, so nothing they wrote leaves the browser.
    // Autocapture records which element was clicked, not its text or
    // attributes (an item row's label is its title).
    mask_all_text: true,
    mask_all_element_attributes: true,
    // Replays keep the layout and every click, with all text and input
    // values masked and images (avatars) blocked. Attributes rrweb doesn't
    // mask are masked in before_send, which needs the events uncompressed;
    // the request batch is still gzipped. No network bodies or headers: a
    // Server Action's body is what the user typed.
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      blockSelector: "img",
      compress_events: false,
      recordHeaders: false,
      recordBody: false,
    },
    before_send: (event) => {
      if (event?.event === "$snapshot") maskReplayAttributes(event.properties.$snapshot_data);
      return event;
    },
  });
  // Tag every event (errors included) with the deployed commit.
  if (RELEASE) posthog.register({ release: RELEASE });
}
