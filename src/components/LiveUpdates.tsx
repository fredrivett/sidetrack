"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { refreshIfCurrent } from "@/components/LatestDeploy";

/** Changes this close together reload the page once, e.g. a drag's moves. */
const SETTLE_MS = 300;
/** How long to wait before reconnecting after the server turned the stream away. */
const RETRY_MS = 5_000;

/**
 * Reloads the page whenever something on it changes elsewhere: in another tab
 * or browser, by a collaborator, an agent, or GitHub (see /api/events).
 * Listens only while the page is visible.
 *
 * `seq` is the number of the last change the page was rendered with
 * (changeSeq). A change this tab saved comes back as an event too, but the
 * save's own response has already rendered the page past it, so it doesn't
 * reload the page a second time.
 */
export function LiveUpdates({ seq }: { seq: number }) {
  const router = useRouter();
  const rendered = useRef(seq);
  useEffect(() => {
    rendered.current = seq;
  }, [seq]);
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    /** The change the page has to show once things settle. */
    let wanted = 0;
    function reload(change: number) {
      wanted = Math.max(wanted, change);
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Checked now, not as the event arrives: a save's response usually
        // lands after its own event.
        if (wanted > rendered.current) void refreshIfCurrent(router);
        wanted = 0;
      }, SETTLE_MS);
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
      // The stream reconnects after a deploy, to the new build.
      events.onopen = () => reload(Infinity);
      events.onmessage = (event) => {
        const change = Number(event.data);
        // Anything but a number, which no server sends today, still reloads.
        reload(Number.isNaN(change) ? Infinity : change);
      };
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
