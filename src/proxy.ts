import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// Proxy must not import shared modules with mutable state. Web auth is a
// cookie-presence check (the route handlers do real validation). MCP auth
// is enforced inside the /mcp route handler — it needs a DB lookup, which
// we keep out of the proxy. The proxy just lets /mcp requests through.

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // MCP endpoint is publicly reachable; the route handler verifies the
  // per-user API key and returns 401 if missing or unknown.
  if (pathname.startsWith("/mcp")) return NextResponse.next();
  // Same for GitHub's webhook deliveries: the route handler checks each one's
  // signature against the webhook's secret and returns 401 otherwise.
  if (pathname.startsWith("/api/github/")) return NextResponse.next();

  // Password reset pages must work signed-out: /forgot-password requests the
  // email, /reset-password is where the emailed link lands (with ?token=).
  // The landing page is public too (signed-out visitors see it at /, below).
  if (
    pathname === "/welcome" ||
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.next();
  }

  // PWA static assets must be reachable unauthenticated: the browser fetches
  // the manifest, icons and iOS startup images (/icons/startup/) from <head>
  // even on the login page, and the service worker registers there and caches
  // the (data-free) /launch skeleton.
  if (
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons/") ||
    pathname === "/sw.js" ||
    pathname === "/launch"
  ) {
    return NextResponse.next();
  }

  // What search engines and link previews fetch: robots.txt, the sitemap and
  // the social card (src/app/opengraph-image.tsx, at /opengraph-image-<hash>).
  if (
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/opengraph-image")
  ) {
    return NextResponse.next();
  }

  // Presence check only — the real session validation happens in route
  // handlers / RSCs via auth.api.getSession (which hits the DB). The proxy
  // just bounces unauthenticated traffic to /login so we don't render any
  // app shell first.
  if (!getSessionCookie(request)) {
    // Signed out, / is the landing page rather than the board, at the same
    // URL. A stale cookie still reaches the board, which sends it to /login.
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/welcome", request.url));
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // The Agenda was renamed the Brief: old links and notifications open it.
  if (pathname === "/agenda") {
    const url = request.nextUrl.clone();
    url.pathname = "/brief";
    return NextResponse.redirect(url);
  }

  // Each view has its own path, served by the one board page (app/(board)) so
  // switching views in the browser (Kanban's switchView) never remounts it.
  if (VIEWS.includes(pathname.slice(1))) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("view", pathname.slice(1));
    return NextResponse.rewrite(url);
  }
  // / opens the Brief; links from before views had paths (?view=, or ?p=
  // for a list on the board) open the view they meant.
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    const view = url.searchParams.get("view") ?? "";
    url.searchParams.delete("view");
    url.pathname = VIEWS.includes(view)
      ? `/${view}`
      : view === "agenda"
        ? "/brief"
      : url.searchParams.has("p") && view !== "today" && view !== "no-date"
        ? "/board"
        : "/brief";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

const VIEWS = ["brief", "board", "done", "archived"];

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
