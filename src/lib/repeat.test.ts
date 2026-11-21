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
  const span = (dueFrom: string | null, dueDate: string) => ({ dueFrom, dueDate });
  // November 2026: Mon 16 to Sun 22 is a week, Sat 21 and Sun 22 its weekend.

  it("comes back on the rule's day, counted from when it was done", () => {
    // Due this weekend, done three days late on Wednesday 25: two weeks on,
    // on that day alone; it was due on a weekend only this time.
    expect(nextDue("2026-11-25", { every: 2, unit: "week" })).toEqual(span(null, "2026-12-09"));
  });

  it("keeps to weekends from the rule's day, never sooner", () => {
    const fortnightly = { every: 2, unit: "week", on: "weekend" } as const;
    // Done late on Wednesday 25: the weekend after Wednesday 9 December, not
    // the 5th, which the schedule would have kept to.
    expect(nextDue("2026-11-25", fortnightly)).toEqual(span("2026-12-12", "2026-12-13"));
    // Done on time on Saturday 21, or on its Sunday: the weekend two weeks on.
    expect(nextDue("2026-11-21", fortnightly)).toEqual(span("2026-12-05", "2026-12-06"));
    expect(nextDue("2026-11-22", fortnightly)).toEqual(span("2026-12-05", "2026-12-06"));
  });

  it("keeps to a weekday from the rule's day, never sooner", () => {
    // Two weeks after Wednesday 25 is Wednesday 9 December: the Monday after
    // it, not the Monday before.
    expect(nextDue("2026-11-25", { every: 2, unit: "week", on: "mon" })).toEqual(
      span(null, "2026-12-14"),
    );
    // Done on its day: that day a week on. Sunday ends the week.
    expect(nextDue("2026-11-16", { every: 1, unit: "week", on: "mon" })).toEqual(
      span(null, "2026-11-23"),
    );
    expect(nextDue("2026-11-18", { every: 1, unit: "week", on: "sun" })).toEqual(
      span(null, "2026-11-29"),
    );
    // A month after Wednesday 18 November is Friday 18 December.
    expect(nextDue("2026-11-18", { every: 1, unit: "month", on: "fri" })).toEqual(
      span(null, "2026-12-18"),
    );
  });
});

describe("a rule on a day of the month", () => {
  const monthly = (day: number, every = 1) => ({ every, unit: "month", day }) as const;

  it("comes back on the next of that day after it's done, early or late", () => {
    // Due 1 November, done on 21 November: 1 December, not 21 December.
    expect(nextDue("2026-11-21", monthly(1))).toEqual({ dueFrom: null, dueDate: "2026-12-01" });
    // Done on the day itself: a month on, across the year end.
    expect(nextDueDay("2026-12-01", monthly(1))).toBe("2027-01-01");
    // Done early, before that day comes round this month: this month's.
    expect(nextDueDay("2026-11-10", monthly(15))).toBe("2026-11-15");
    expect(nextDueDay("2026-11-15", monthly(15))).toBe("2026-12-15");
  });

  it("counts `every` months from the next of that day", () => {
    expect(nextDueDay("2026-11-21", monthly(1, 3))).toBe("2027-02-01");
    expect(nextDueDay("2026-11-01", monthly(1, 3))).toBe("2027-02-01");
    expect(nextDueDay("2026-11-10", monthly(15, 2))).toBe("2026-12-15");
  });

  it("uses a shorter month's last day, and the day again after it", () => {
    expect(nextDueDay("2027-02-10", monthly(31))).toBe("2027-02-28");
    expect(nextDueDay("2028-02-10", monthly(30))).toBe("2028-02-29");
    // Done on February's last day: March keeps the 31st, not the 28th.
    expect(nextDueDay("2027-02-28", monthly(31))).toBe("2027-03-31");
    // November's last day stood in for the 31st, so it's done for November.
    expect(nextDueDay("2026-11-30", monthly(31))).toBe("2026-12-31");
    expect(nextDueDay("2026-12-31", monthly(31, 2))).toBe("2027-02-28");
  });
});

describe("repeatLabel", () => {
  it("names a day of the month as an ordinal", () => {
    expect(repeatLabel({ every: 1, unit: "month", day: 1 })).toBe("Every month on the 1st");
    expect(repeatLabel({ every: 2, unit: "month", day: 22 })).toBe("Every 2 months on the 22nd");
    expect(
      [2, 3, 4, 11, 12, 13, 21, 23, 31].map((day) => repeatLabel({ every: 1, unit: "month", day }).slice(19)),
    ).toEqual(["2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "23rd", "31st"]);
  });

  it("says every unit, with the count when it isn't one", () => {
    expect(repeatLabel({ every: 1, unit: "month" })).toBe("Every month");
    expect(repeatLabel({ every: 3, unit: "day" })).toBe("Every 3 days");
    expect(repeatLabel({ every: 2, unit: "week", on: "weekend" })).toBe("Every 2 weeks on weekends");
    expect(repeatLabel({ every: 1, unit: "month", on: "sat" })).toBe("Every month on Saturdays");
  });
});
