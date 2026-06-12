import { describe, expect, it } from "vitest";
import { normalizeHomepageUrl } from "./url";

describe("normalizeHomepageUrl", () => {
  it("returns null for blank input", () => {
    expect(normalizeHomepageUrl("")).toBeNull();
    expect(normalizeHomepageUrl("   ")).toBeNull();
  });

  it("adds an https:// scheme to a bare host", () => {
    expect(normalizeHomepageUrl("sidetrack.it")).toBe("https://sidetrack.it/");
    expect(normalizeHomepageUrl("  example.com/app ")).toBe(
      "https://example.com/app",
    );
  });

  it("preserves an existing http(s) scheme and path", () => {
    expect(normalizeHomepageUrl("http://example.com/x?y=1")).toBe(
      "http://example.com/x?y=1",
    );
    expect(normalizeHomepageUrl("https://example.com")).toBe(
      "https://example.com/",
    );
  });

  it("rejects a single-word host (likely a typo)", () => {
    expect(() => normalizeHomepageUrl("localhost")).toThrow(
      /invalid homepage URL/,
    );
    expect(() => normalizeHomepageUrl("foo")).toThrow(/invalid homepage URL/);
  });

  it("rejects non-http schemes", () => {
    expect(() => normalizeHomepageUrl("javascript:alert(1)")).toThrow(
      /invalid homepage URL/,
    );
    expect(() => normalizeHomepageUrl("ftp://example.com")).toThrow(
      /invalid homepage URL/,
    );
  });
});
