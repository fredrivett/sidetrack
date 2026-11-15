import { describe, expect, it } from "vitest";
import { nextDueDay, repeatLabel } from "./repeat";

describe("nextDueDay", () => {
  it("adds days and weeks across month and year ends", () => {
    expect(nextDueDay("2026-11-29", { every: 3, unit: "day" })).toBe("2026-12-02");
    expect(nextDueDay("2026-12-24", { every: 2, unit: "week" })).toBe("2027-01-07");
  });

  it("keeps the day of the month, or the month's last day when it's shorter", () => {
    expect(nextDueDay("2026-11-14", { every: 1, unit: "month" })).toBe("2026-12-14");
    expect(nextDueDay("2027-01-31", { every: 1, unit: "month" })).toBe("2027-02-28");
    expect(nextDueDay("2028-01-31", { every: 1, unit: "month" })).toBe("2028-02-29");
    expect(nextDueDay("2026-08-31", { every: 3, unit: "month" })).toBe("2026-11-30");
    expect(nextDueDay("2026-12-15", { every: 2, unit: "month" })).toBe("2027-02-15");
  });
});

describe("repeatLabel", () => {
  it("says every unit, with the count when it isn't one", () => {
    expect(repeatLabel({ every: 1, unit: "month" })).toBe("Every month");
    expect(repeatLabel({ every: 3, unit: "day" })).toBe("Every 3 days");
  });
});
