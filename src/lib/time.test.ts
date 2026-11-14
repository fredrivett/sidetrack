import { describe, expect, it } from "vitest";
import { nextDayStart, startOfDay } from "./time";

// Local wall-clock times, so these hold in whatever timezone the tests run.
const at = (day: number, h: number, m = 0) =>
  new Date(2026, 10, day, h, m).getTime();

describe("startOfDay", () => {
  it("turns the day over at 4am, not midnight", () => {
    expect(startOfDay(at(14, 3, 59))).toBe(at(13, 4));
    expect(startOfDay(at(14, 0, 30))).toBe(at(13, 4));
    expect(startOfDay(at(14, 4))).toBe(at(14, 4));
    expect(startOfDay(at(14, 23, 59))).toBe(at(14, 4));
  });

  it("crosses month boundaries", () => {
    expect(startOfDay(new Date(2026, 11, 1, 2).getTime())).toBe(at(30, 4));
  });

  it("gives the next turnover", () => {
    expect(nextDayStart(at(14, 3, 59))).toBe(at(14, 4));
    expect(nextDayStart(at(14, 4))).toBe(at(15, 4));
  });
});
