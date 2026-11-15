"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Changes this close together reload the page once, e.g. a drag's moves. */
const SETTLE_MS = 300;
/** How long to wait before reconnecting after the server turned the stream away. */
const RETRY_MS = 5_000;

/**
 * Reloads the page whenever something on it changes elsewhere: in another tab
 * or browser, by a collaborator, an agent, or GitHub (see /api/events).
 * Listens only while the page is visible.
 */
export function LiveUpdates() {
  const router = useRouter();
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    function reload() {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), SETTLE_MS);
    }
    function stop() {
      source?.close();
      source = null;
      clearTimeout(retry);
    }
    function listen() {
      if (document.visibilityState !== "visible") return stop();
      if (source) return;
      const events = new EventSource("/api/events");
      // Reload on every open, first or reconnect: changes made before it
      // opened (since the page rendered, or while it was down) were missed.
      events.onopen = reload;
      events.onmessage = reload;
      events.onerror = () => {
        // EventSource retries a dropped connection by itself, but gives up
        // when the retry gets an error response, such as a 502 mid-deploy.
        if (events.readyState === EventSource.CLOSED) {
          stop();
          retry = setTimeout(listen, RETRY_MS);
        }
      };
      source = events;
    }
    listen();
    document.addEventListener("visibilitychange", listen);
    return () => {
      document.removeEventListener("visibilitychange", listen);
      stop();
      clearTimeout(timer);
    };
  }, [router]);
  return null;
}
