import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { safeCompare } from "./lib/auth";

// Proxy must not import shared modules with mutable state. Token compare
// (MCP) and cookie presence (web) are both pure header-level checks.

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/mcp")) {
    // Prefer the Authorization header (curl, scripts). Fall back to a
    // ?key= query param because claude.ai custom connectors only support
    // OAuth — there is no header field — so the token must ride in the URL.
    // Per-user API keys land in phase 4; today this still gates on the
    // shared MCP_TOKEN env var.
    const header = request.headers.get("authorization");
    const headerToken = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : undefined;
    const queryToken = request.nextUrl.searchParams.get("key") ?? undefined;
    const token = headerToken ?? queryToken;
    if (!safeCompare(token, process.env.MCP_TOKEN)) {
      return new NextResponse("unauthorized", { status: 401 });
    }
    return NextResponse.next();
  }

  if (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
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
