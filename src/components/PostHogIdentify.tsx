"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

/**
 * Tells PostHog who's signed in, by their user id and username only, so their
 * events, replays and feedback link back to them. A no-op without PostHog.
 */
export function PostHogIdentify({ userId, username }: { userId: string; username: string | null }) {
  useEffect(() => {
    if (posthog.__loaded) posthog.identify(userId, { username });
  }, [userId, username]);
  return null;
}
