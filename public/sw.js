// Lets the installed app paint its loading skeleton without waiting on the
// network. It keeps the /launch page (the manifest's start_url) and the CSS
// and fonts that page links in a cache, serves them from it, and refreshes
// them in the background on every launch. It never caches the board or any
// other page: every other request goes to the network as if it weren't here.

const CACHE = "launch";
const LAUNCH = "/launch";

// Fetches /launch and the CSS and fonts it links, and swaps them in for the
// cached copies. Next's asset URLs are content-hashed, so an unchanged asset
// is never fetched again, and a failed fetch leaves the old copies in place.
async function refresh() {
  const page = await fetch(LAUNCH, { cache: "no-store" });
  if (!page.ok) return;
  const html = await page.clone().text();
  const assets = [
    ...new Set(
      Array.from(
        html.matchAll(/href="(\/_next\/static\/[^"?]+\.(?:css|woff2))"/g),
        (m) => m[1],
      ),
    ),
  ];
  const cache = await caches.open(CACHE);
  const cached = new Set(
    (await cache.keys()).map((req) => new URL(req.url).pathname),
  );
  await cache.addAll(assets.filter((url) => !cached.has(url)));
  await cache.put(LAUNCH, page);
  const keep = new Set([LAUNCH, ...assets]);
  for (const req of await cache.keys()) {
    if (!keep.has(new URL(req.url).pathname)) await cache.delete(req);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(refresh());
  self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname === LAUNCH) {
    event.respondWith(
      caches.match(LAUNCH).then((cached) => cached ?? fetch(request)),
    );
    event.waitUntil(refresh().catch(() => {}));
  } else if (
    url.pathname.startsWith("/_next/static/") &&
    /\.(?:css|woff2)$/.test(url.pathname)
  ) {
    // Only the launch page's assets are cached; the rest fall through to the
    // network. That includes the board's CSS and font, which are the same files.
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request)),
    );
  }
});
