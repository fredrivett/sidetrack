import { describe, expect, it } from "vitest";
import { nextDue, nextDueDay, repeatLabel } from "./repeat";

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

describe("nextDue", () => {
  const weekly = { every: 1, unit: "week" } as const;
  const daily = { every: 1, unit: "day" } as const;
  const span = (dueFrom: string | null, dueDate: string) => ({ dueFrom, dueDate });
  // November 2026: Mon 16 to Sun 22 is a week, Sat 21 and Sun 22 its weekend.
  const week = span("2026-11-16", "2026-11-22");
  const weekend = span("2026-11-21", "2026-11-22");

  it("brings a day back on the rule's day", () => {
    expect(nextDue("2026-11-18", weekly, span(null, "2026-11-20"))).toEqual(span(null, "2026-11-25"));
    expect(nextDue("2026-11-18", weekly, null)).toEqual(span(null, "2026-11-25"));
  });

  it("brings a week or weekend back as the one the rule's day falls in", () => {
    // Done Wednesday: due next week, from Monday, not from next Wednesday.
    expect(nextDue("2026-11-18", weekly, week)).toEqual(span("2026-11-23", "2026-11-29"));
    // Done on the Sunday, or early on the Wednesday: next weekend either way.
    expect(nextDue("2026-11-22", weekly, weekend)).toEqual(span("2026-11-28", "2026-11-29"));
    expect(nextDue("2026-11-18", weekly, weekend)).toEqual(span("2026-11-28", "2026-11-29"));
    // A month on from Wednesday 18 November is Friday 18 December.
    expect(nextDue("2026-11-18", { every: 1, unit: "month" }, week)).toEqual(
      span("2026-12-14", "2026-12-20"),
    );
  });

  it("never comes back before the day after it was done", () => {
    // Daily: the rest of this week, or of this weekend (one day is a day).
    expect(nextDue("2026-11-18", daily, week)).toEqual(span("2026-11-19", "2026-11-22"));
    expect(nextDue("2026-11-21", daily, weekend)).toEqual(span(null, "2026-11-22"));
  });

  it("moves any other span to the rule's day, keeping its length", () => {
    // Monday to Wednesday, done Tuesday: next Tuesday to Thursday.
    expect(nextDue("2026-11-17", weekly, span("2026-11-16", "2026-11-18"))).toEqual(
      span("2026-11-24", "2026-11-26"),
    );
  });
});

describe("repeatLabel", () => {
  it("says every unit, with the count when it isn't one", () => {
    expect(repeatLabel({ every: 1, unit: "month" })).toBe("Every month");
    expect(repeatLabel({ every: 3, unit: "day" })).toBe("Every 3 days");
  });
});
