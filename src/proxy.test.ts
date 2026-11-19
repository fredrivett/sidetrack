import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const signedOut = (path: string) => proxy(new NextRequest(`https://sidetrack.test${path}`));

describe("proxy, signed out", () => {
  // Crawlers and link previews have no session: bouncing them to /login
  // loses the search listing and the social card.
  it.each(["/robots.txt", "/sitemap.xml", "/opengraph-image", "/opengraph-image?e6d4e2ff"])(
    "lets %s through",
    (path) => {
      const res = signedOut(path);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("still sends app pages to sign in", () => {
    expect(signedOut("/settings/profile").headers.get("location")).toBe(
      "https://sidetrack.test/login?next=%2Fsettings%2Fprofile",
    );
    expect(signedOut("/agenda").headers.get("location")).toBe(
      "https://sidetrack.test/login?next=%2Fagenda",
    );
  });

  it("shows the landing page at /", () => {
    expect(signedOut("/").headers.get("x-middleware-rewrite")).toBe("https://sidetrack.test/welcome");
  });
});

describe("proxy, signed in", () => {
  const signedIn = (path: string) =>
    proxy(
      new NextRequest(`https://sidetrack.test${path}`, {
        headers: { cookie: "better-auth.session_token=abc.def" },
      }),
    );

  // One page serves every view, so switching views never remounts it.
  it.each([
    ["/agenda", "https://sidetrack.test/?view=agenda"],
    ["/board?p=L1", "https://sidetrack.test/?p=L1&view=board"],
    ["/done", "https://sidetrack.test/?view=done"],
    ["/archived", "https://sidetrack.test/?view=archived"],
  ])("serves %s from the board page", (path, target) => {
    const res = signedIn(path);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBe(target);
  });

  // Links from notifications and bookmarks made before views had paths.
  it.each([
    ["/", "/agenda"],
    ["/?view=done", "/done"],
    ["/?view=archived", "/archived"],
    ["/?view=today", "/agenda"],
    ["/?view=no-date&p=L1", "/agenda?p=L1"],
    ["/?p=L1&item=I1", "/board?p=L1&item=I1"],
    ["/?item=I1", "/agenda?item=I1"],
  ])("sends %s to %s", (path, target) => {
    const res = signedIn(path);
    expect(res.headers.get("location")).toBe(`https://sidetrack.test${target}`);
    // Temporary, never permanent: a cached / → /agenda would hide the
    // welcome page after signing out.
    expect(res.status).toBe(307);
  });

  it("leaves other pages alone", () => {
    const res = signedIn("/settings/profile");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
