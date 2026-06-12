import { describe, expect, it } from "vitest";
import {
  faviconUrl,
  isEmoji,
  normalizeProjectIcon,
  resolveProjectIcon,
} from "./projectIcon";

describe("isEmoji", () => {
  it("accepts emoji, including ZWJ sequences, skin tones, flags, and keycaps", () => {
    expect(isEmoji("🚀")).toBe(true);
    expect(isEmoji("👩‍💻")).toBe(true);
    expect(isEmoji("👍🏽")).toBe(true);
    expect(isEmoji("❤️")).toBe(true);
    expect(isEmoji("🇬🇧")).toBe(true);
    expect(isEmoji("1️⃣")).toBe(true);
    expect(isEmoji("#️⃣")).toBe(true);
  });

  it("rejects plain text, mixed text+emoji, and URLs", () => {
    expect(isEmoji("hello")).toBe(false);
    // Anchored end-to-end: a stray emoji inside text must not pass.
    expect(isEmoji("a🚀")).toBe(false);
    expect(isEmoji("🚀 launch")).toBe(false);
    // A bare digit/hash is not a keycap (no enclosing-keycap mark).
    expect(isEmoji("1")).toBe(false);
    expect(isEmoji("#")).toBe(false);
    expect(isEmoji("12")).toBe(false);
    expect(isEmoji("https://example.com/a.png")).toBe(false);
    expect(isEmoji("")).toBe(false);
  });
});

describe("normalizeProjectIcon", () => {
  it("returns null for blank input", () => {
    expect(normalizeProjectIcon("  ")).toBeNull();
  });

  it("passes an emoji through verbatim", () => {
    expect(normalizeProjectIcon("🚀")).toBe("🚀");
  });

  it("normalizes an image URL (adds scheme)", () => {
    expect(normalizeProjectIcon("cdn.example.com/logo.png")).toBe(
      "https://cdn.example.com/logo.png",
    );
  });

  it("rejects a value that is neither emoji nor URL", () => {
    expect(() => normalizeProjectIcon("not an icon")).toThrow(
      /invalid project icon/,
    );
  });
});

describe("faviconUrl", () => {
  it("derives a Google s2 favicon URL from the host", () => {
    expect(faviconUrl("https://sidetrack.it/app")).toBe(
      "https://www.google.com/s2/favicons?domain=sidetrack.it&sz=64",
    );
  });

  it("returns null for an unparseable URL", () => {
    expect(faviconUrl("not a url")).toBeNull();
  });
});

describe("resolveProjectIcon", () => {
  it("prefers an explicit emoji", () => {
    expect(resolveProjectIcon("🚀", "https://x.com")).toEqual({
      kind: "emoji",
      emoji: "🚀",
    });
  });

  it("treats an explicit URL icon as an image", () => {
    expect(resolveProjectIcon("https://x.com/a.png", null)).toEqual({
      kind: "image",
      src: "https://x.com/a.png",
    });
  });

  it("falls back to the homepage favicon when no icon is set", () => {
    expect(resolveProjectIcon(null, "https://sidetrack.it")).toEqual({
      kind: "image",
      src: "https://www.google.com/s2/favicons?domain=sidetrack.it&sz=64",
    });
  });

  it("resolves to none with neither icon nor homepage", () => {
    expect(resolveProjectIcon(null, null)).toEqual({ kind: "none" });
  });
});
