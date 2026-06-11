import { describe, expect, it } from "vitest";
import { prLabel } from "./pr";

describe("prLabel", () => {
  it("renders a github.com PR URL as owner/repo#number", () => {
    expect(prLabel("https://github.com/fredrivett/sidetrack/pull/42")).toBe(
      "fredrivett/sidetrack#42",
    );
  });

  it("accepts the www host", () => {
    expect(prLabel("https://www.github.com/a/b/pull/7")).toBe("a/b#7");
  });

  it("does not label a non-GitHub host that embeds the github.com path", () => {
    const spoof = "https://evil.com/github.com/a/b/pull/1";
    expect(prLabel(spoof)).toBe(spoof);
  });

  it("does not label a look-alike subdomain host", () => {
    const spoof = "https://github.com.evil.com/a/b/pull/1";
    expect(prLabel(spoof)).toBe(spoof);
  });

  it("falls back to the raw string for a non-PR github URL", () => {
    const url = "https://github.com/fredrivett/sidetrack/issues/9";
    expect(prLabel(url)).toBe(url);
  });

  it("falls back to the raw string for an unparseable URL", () => {
    expect(prLabel("not a url")).toBe("not a url");
  });
});
