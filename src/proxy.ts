import { type NextRequest, NextResponse } from "next/server";
import { safeCompare, WEB_COOKIE } from "./lib/auth";

// Proxy must not import shared modules with mutable state. Token check is
// pure: env var compared in constant time.

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/mcp")) {
    // Prefer the Authorization header (curl, scripts). Fall back to a
    // ?key= query param because claude.ai custom connectors only support
    // OAuth — there is no header field — so the token must ride in the URL.
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

  if (pathname === "/login" || pathname.startsWith("/login/")) {
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

  const cookie = request.cookies.get(WEB_COOKIE)?.value;
  if (!safeCompare(cookie, process.env.WEB_TOKEN)) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
