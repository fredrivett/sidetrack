import { getCurrentSession } from "@/auth/session";
import { findFavicon, type FoundIcon } from "@/lib/favicon";
import { safeFetch } from "@/lib/safeFetch";
import { normalizeWebUrl } from "@/lib/url";

// Finding an icon takes a few requests to the site, and every board shows the
// icon of each list with a homepage, so results are kept in memory for a while.
// A miss is kept for less time, so a site that was down gets another chance.
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED = 500;
// The whole search for one homepage, across all its requests.
const SEARCH_TIMEOUT_MS = 10_000;
// Searches running at once, across everyone. Past this, a new homepage gets
// a 503 (the <img> moves on to the next candidate) rather than more outbound
// requests, so a flood of unique URLs can't tie up the server.
const MAX_IN_FLIGHT = 16;
let inFlight = 0;

const cache = new Map<
  string,
  { expires: number; icon: Promise<FoundIcon | null> }
>();

function lookUpFavicon(homepage: string): Promise<FoundIcon | null> | "busy" {
  const now = Date.now();
  const hit = cache.get(homepage);
  if (hit && hit.expires > now) return hit.icon;
  if (inFlight >= MAX_IN_FLIGHT) return "busy";
  cache.delete(homepage);
  // Drop the oldest entries (Map keeps insertion order) to bound memory.
  for (const key of cache.keys()) {
    if (cache.size < MAX_CACHED) break;
    cache.delete(key);
  }
  // Not tied to the request: other requests share this search, so one
  // browser going away mustn't cancel it for the rest.
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  inFlight++;
  const icon = findFavicon(homepage, (url, { maxBytes }) =>
    safeFetch(url, { maxBytes, signal }),
  )
    .catch(() => null)
    .finally(() => inFlight--);
  // Shared while in flight; once settled, kept for as long as its outcome
  // deserves.
  const entry = { expires: now + SEARCH_TIMEOUT_MS, icon };
  cache.set(homepage, entry);
  void icon.then((found) => {
    entry.expires = Date.now() + (found ? FOUND_TTL_MS : MISSING_TTL_MS);
  });
  return icon;
}

/**
 * Serves the icon of the website at ?url=, found by reading the site the way
 * a browser does (see findFavicon). 404 when it has none, so the <img> moves
 * on to its next candidate. The icon is re-served from here rather than
 * linked, which also covers icons a site won't let other origins embed and
 * icons inlined as data: URLs.
 */
export async function GET(request: Request) {
  if (!(await getCurrentSession())) {
    return new Response(null, { status: 401 });
  }
  let homepage: URL | null = null;
  try {
    const normalized = normalizeWebUrl(
      new URL(request.url).searchParams.get("url") ?? "",
    );
    if (normalized) homepage = new URL(normalized);
  } catch {
    // Falls through to the 400 below.
  }
  if (!homepage) return new Response(null, { status: 400 });
  // Neither reaches the site we fetch (safeFetch drops credentials), so
  // they mustn't make a separate cache entry either.
  homepage.hash = "";
  homepage.username = "";
  homepage.password = "";

  const found = lookUpFavicon(homepage.toString());
  if (found === "busy") return new Response(null, { status: 503 });
  const icon = await found;
  if (!icon) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  }
  return new Response(new Uint8Array(icon.body), {
    headers: {
      // The sniffed format, never what the site claimed.
      "Content-Type": icon.contentType,
      "Cache-Control": "private, max-age=86400",
      // Only ever an image: never sniff it as anything else, nor run anything
      // (an SVG opened directly could otherwise run script on this origin).
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
