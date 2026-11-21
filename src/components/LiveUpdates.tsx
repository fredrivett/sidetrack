"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { refreshIfCurrent } from "@/components/LatestDeploy";
import type { Seen } from "@/core/changes";

/** Changes this close together reload the page once, e.g. a drag's moves. */
const SETTLE_MS = 300;
/** How long to wait before reconnecting after the server turned the stream away. */
const RETRY_MS = 5_000;

/** The rows the board holds ahead of the page (useSavedItems). */
export interface LiveRows {
  /** The change number its copy of the item is as of; -Infinity for none. */
  asOf: (id: string) => number;
  /** Whether changes `first` to `last` were all made by its own saves. */
  own: (first: number, last: number) => boolean;
  /** Puts rows read from /api/items in. */
  merge: (saved: unknown) => void;
}

/**
 * Keeps the page up to date as things on it change elsewhere: in another tab
 * or browser, by a collaborator, an agent, or GitHub (see /api/events).
 * Listens only while the page is visible.
 *
 * `seq` is the number of the last change the page was rendered with
 * (changeSeq). A change this tab saved comes back as an event too, but the
 * save has already shown it, by rendering the page past it or by handing
 * back its rows (`rows.own`), so it isn't shown again. A change that only
 * altered items whose rows show all of it reads just the rows the board
 * doesn't hold as new (`rows.asOf`); anything else reloads the page.
 */
export function LiveUpdates({ seq, rows }: { seq: number; rows?: LiveRows }) {
  const router = useRouter();
  const rendered = useRef(seq);
  const live = useRef(rows);
  useEffect(() => {
    rendered.current = seq;
    live.current = rows;
  }, [seq, rows]);
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    /** The change the page has to show once things settle. */
    let wanted = 0;
    /** Changes about items, judged once things settle. */
    let heard: ({ seq: number } & NonNullable<Seen>)[] = [];
    function settle() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Judged now, not as each event arrives: a save's response usually
        // lands after its own event.
        const ids = new Set<string>();
        for (const event of heard) {
          if (event.seq <= rendered.current) continue;
          const rows = live.current;
          if (event.rows && rows) {
            // The rows show all of it: read those the board doesn't hold as new.
            for (const id of event.items) if (rows.asOf(id) < event.seq) ids.add(id);
          } else if (!rows?.own(event.first, event.seq) || event.items.some((id) => rows.asOf(id) < event.seq)) {
            // More than rows changed, which only this tab's own saves have
            // already shown (with their rows, and what they made it follow).
            wanted = Math.max(wanted, event.seq);
          }
        }
        if (wanted > rendered.current) void refreshIfCurrent(router);
        else if (ids.size > 0) void read([...ids]);
        wanted = 0;
        heard = [];
      }, SETTLE_MS);
    }
    function reload(change: number) {
      wanted = Math.max(wanted, change);
      settle();
    }
    async function read(ids: string[]) {
      try {
        const res = await fetch(`/api/items?ids=${ids.map(encodeURIComponent).join(",")}`);
        if (!res.ok) throw new Error(`/api/items: ${res.status}`);
        live.current?.merge(await res.json());
      } catch {
        // Missed rows would stay wrong until the next reload: reload now.
        void refreshIfCurrent(router);
      }
    }
    function hear(data: string) {
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        event = null;
      }
      if (typeof event === "number") return reload(event);
      const seen = event as { seq: number } & NonNullable<Seen>;
      // Anything else, which no server sends today, still reloads.
      if (typeof seen?.seq !== "number" || !Array.isArray(seen.items)) return reload(Infinity);
      heard.push(seen);
      settle();
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
      events.onmessage = (event) => hear(event.data);
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
