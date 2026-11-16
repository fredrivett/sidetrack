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
  });
});
