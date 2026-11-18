"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";

// Who's been on the landing page, and who's on it now, by here/now
// (herenow.fyi). Its widget draws its own boxed look, so this talks to its
// API directly and shows the counts in the footer's style.
//
// Only sidetrack.it counts visits and shows the counts (here/now allows that
// domain); self-hosted instances show nothing, as these aren't their visitors.

const API = "https://api.herenow.fyi";
const DOMAIN = "sidetrack.it";
// The landing page is at / and /welcome; both count as /, its canonical URL.
const PATH = "/";
/** here/now counts you as "now" for 5 minutes after a visit: say you're still here a bit sooner. */
const STILL_HERE = 4 * 60 * 1000;
/** How often the counts on screen are checked again. */
const REFRESH = 60 * 1000;

type Count = { here: number; now: number };

/** The same ids as here/now's widget, so a visitor is one person to both. */
function ids() {
  let user = localStorage.getItem("herenow_user_id");
  if (!user) localStorage.setItem("herenow_user_id", (user = crypto.randomUUID()));
  let session = sessionStorage.getItem("herenow_session_id");
  if (!session) sessionStorage.setItem("herenow_session_id", (session = crypto.randomUUID()));
  return { user, session };
}

async function visit() {
  const { user, session } = ids();
  await fetch(`${API}/api/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain: DOMAIN, path: PATH, user_id: user, session_id: session }),
    signal: AbortSignal.timeout(8000),
  });
}

async function fetchCount(): Promise<Count> {
  const res = await fetch(`${API}/api/stats?domain=${DOMAIN}&path=${encodeURIComponent(PATH)}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`here/now: ${res.status}`);
  const { here, now } = (await res.json()) as Count;
  return { here, now };
}

/** "1,204 here · ● 5 now · herenow.fyi", or nothing until here/now answers. */
export function HereNow() {
  const [count, setCount] = useState<Count | null>(null);

  useEffect(() => {
    if (location.hostname.replace(/^www\./, "") !== DOMAIN) return;
    let live = true;
    let lastVisit = 0;
    // While the page is in view: count yourself in again before here/now
    // forgets you, then show the counts, which include you.
    const update = async () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastVisit >= STILL_HERE) {
        lastVisit = Date.now();
        await visit().catch(() => {});
      }
      // A count already showing stays when here/now doesn't answer.
      const c = await fetchCount().catch(() => null);
      if (live && c) setCount(c);
    };
    void update();
    const timer = window.setInterval(update, REFRESH);
    document.addEventListener("visibilitychange", update);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  if (!count) return null;
  return (
    <span className="flex items-center gap-2 tabular-nums">
      <span>
        <span className="font-medium text-foreground">{count.here.toLocaleString("en-GB")}</span> here
      </span>
      <span aria-hidden>·</span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-1.5 rounded-full bg-green-500 motion-safe:animate-pulse" />
        <span>
          <span className="font-medium text-foreground">{count.now.toLocaleString("en-GB")}</span> now
        </span>
      </span>
      <span aria-hidden>·</span>
      <a
        href="https://herenow.fyi"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-0.5 hover:text-foreground"
      >
        herenow.fyi
        <ArrowUpRight className="size-3.5" aria-hidden />
      </a>
    </span>
  );
}
