// Lets the installed app paint its loading skeleton without waiting on the
// network. It keeps the /launch page (the manifest's start_url) and the CSS
// and fonts that page links in a cache, serves them from it, and refreshes
// them in the background on every launch. It never caches the board or any
// other page: every other request goes to the network as if it weren't here.
//
// It also shows push notifications (src/lib/push.ts) and opens the app where
// one points when it's tapped.

const CACHE = "launch";
const LAUNCH = "/launch";
// The dev server registers it as /sw.js?dev, for push alone: it serves
// changing CSS at fixed URLs, which the cache would keep serving.
const CACHING = !new URL(self.location.href).searchParams.has("dev");

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
  if (CACHING) event.waitUntil(refresh());
  self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (!CACHING) return;
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
    // Only the launch page's CSS and font are cached, and they're served from
    // the cache whichever page asks, including the board, which uses the same
    // files. Any other CSS or font goes to the network.
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request)),
    );
  }
});

// iOS revokes the subscription of an app that receives a push without
// showing a notification, so every push shows one.
self.addEventListener("push", (event) => {
  let message;
  try {
    message = event.data.json();
  } catch {
    message = { title: "Sidetrack", body: event.data?.text() ?? "", url: "/" };
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: "/icons/icon-192.png",
      data: { url: message.url ?? "/" },
    }),
  );
});

// Opens the app at the notification's page: in a window it already has open
// if there is one, else a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever a page of the app, whatever the push said.
  const target = new URL(event.notification.data?.url ?? "/", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/`;
  event.waitUntil(
    (async () => {
      // Uncontrolled too: a page open since before the worker installed.
      const [open] = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (open) {
        await open.focus();
        if (open.url !== url) await open.navigate(url);
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
