import { describe, expect, it } from "vitest";
import { normalizeRepository } from "./repository";

describe("normalizeRepository", () => {
  it.each([
    ["fredrivett/sidetrack", "fredrivett/sidetrack"],
    ["  fredrivett/sidetrack  ", "fredrivett/sidetrack"],
    ["https://github.com/fredrivett/sidetrack", "fredrivett/sidetrack"],
    ["github.com/fredrivett/sidetrack.git", "fredrivett/sidetrack"],
    ["https://www.github.com/fredrivett/sidetrack/pull/191", "fredrivett/sidetrack"],
    ["git@github.com:fredrivett/side.track.git", "fredrivett/side.track"],
    ["ssh://git@github.com/fredrivett/sidetrack.git", "fredrivett/sidetrack"],
    ["https://github.com/fredrivett/sidetrack?tab=readme", "fredrivett/sidetrack"],
  ])("reads %j as %j", (raw, expected) => {
    expect(normalizeRepository(raw)).toBe(expected);
  });

  it("clears on blank", () => {
    expect(normalizeRepository("   ")).toBeNull();
  });

  it.each([
    "sidetrack",
    "https://gitlab.com/fredrivett/sidetrack",
    "gitlab.com/fredrivett/sidetrack",
    "git@gitlab.com:fredrivett/sidetrack.git",
    "https://github.com/fredrivett",
    "fred_rivett/sidetrack",
    "fredrivett/..",
    "fredrivett/side track",
  ])("refuses %j", (raw) => {
    expect(() => normalizeRepository(raw)).toThrow(/invalid repository/);
  });
});
