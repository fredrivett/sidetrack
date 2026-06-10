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

  // Password reset pages must work signed-out: /forgot-password requests the
  // email, /reset-password is where the emailed link lands (with ?token=).
  if (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.next();
  }

  // PWA static assets must be reachable unauthenticated: the browser fetches
  // the manifest and icons from <head> even on the login page.
  if (
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons/")
  ) {
    return NextResponse.next();
  }

  // Presence check only — the real session validation happens in route
  // handlers / RSCs via auth.api.getSession (which hits the DB). The proxy
  // just bounces unauthenticated traffic to /login so we don't render any
  // app shell first.
  if (!getSessionCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
