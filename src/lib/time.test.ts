import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  dayLabel,
  dayOf,
  dueLabel,
  isDay,
  isOnToday,
  parseDue,
  quickDues,
  nextDayStart,
  startOfDay,
  startOfWeek,
  weekStartBound,
} from "./time";

// A due date on one day, as parseDue and quickDues return it.
const day = (dueDate: string) => ({ dueFrom: null, dueDate });

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

describe("startOfWeek", () => {
  // 9 Nov 2026 is a Monday.
  it("starts at 4am Monday, so the small hours of Monday are still last week", () => {
    expect(startOfWeek(at(15, 23))).toBe(at(9, 4));
    expect(startOfWeek(at(16, 3, 59))).toBe(at(9, 4));
    expect(startOfWeek(at(16, 4))).toBe(at(16, 4));
    expect(startOfWeek(at(11, 12))).toBe(at(9, 4));
  });

  it("bounds the week from the zone's own day, early enough for UTC+14", () => {
    // 01:00 UTC Monday 16 Nov is Sunday evening in New York (week began
    // 09:00 UTC on the 9th) and Monday afternoon in Kiritimati, UTC+14 (week
    // began 14:00 UTC Sunday the 15th).
    const now = Date.UTC(2026, 10, 16, 1);
    expect(weekStartBound("America/New_York", now)).toBe(Date.UTC(2026, 10, 8));
    expect(weekStartBound("Pacific/Kiritimati", now)).toBe(Date.UTC(2026, 10, 15));
  });
});

describe("dayLabel", () => {
  afterEach(() => vi.useRealTimers());

  it("uses the same 4am turnover as startOfDay", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(14, 2));
    // 2am on the 14th still belongs to the 13th.
    expect(dayLabel(at(13, 23))).toBe("Today");
    vi.setSystemTime(at(14, 9));
    expect(dayLabel(at(14, 1))).toBe("Yesterday");
    expect(dayLabel(at(14, 5))).toBe("Today");
    expect(dayLabel(at(13, 3))).toBe(
      new Date(2026, 10, 12).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    );
  });
});

describe("calendar days", () => {
  it("validates, adds across months and years", () => {
    expect(isDay("2026-11-14")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-1-4")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the day of a moment with the 4am turnover, in a given zone", () => {
    // 02:30 UTC on the 15th: still the 14th in London (02:30 local, before
    // 4am), already the 15th in Tokyo (11:30), the 14th in New York (21:30).
    const t = Date.UTC(2026, 10, 15, 2, 30);
    expect(dayOf(t, "Europe/London")).toBe("2026-11-14");
    expect(dayOf(t, "Asia/Tokyo")).toBe("2026-11-15");
    expect(dayOf(t, "America/New_York")).toBe("2026-11-14");
    expect(dayOf(Date.UTC(2026, 10, 15, 4, 0), "Europe/London")).toBe("2026-11-15");
  });

  it("offers today, tomorrow, and this and next week and weekend as spans", () => {
    const span = (dueFrom: string, dueDate: string) => ({ dueFrom, dueDate });
    // Wednesday 18 November: the week runs Monday 16 to Sunday 22.
    expect(quickDues("2026-11-18")).toEqual([
      ["Today", { dueFrom: null, dueDate: "2026-11-18" }],
      ["Tomorrow", { dueFrom: null, dueDate: "2026-11-19" }],
      ["This week", span("2026-11-16", "2026-11-22")],
      ["This weekend", span("2026-11-21", "2026-11-22")],
      ["Next week", span("2026-11-23", "2026-11-29")],
      ["Next weekend", span("2026-11-28", "2026-11-29")],
    ]);
    // Saturday still has this week and weekend ahead; Sunday, their last
    // day, has only today left of them.
    expect(quickDues("2026-11-21").map(([l]) => l)).toEqual([
      "Today",
      "Tomorrow",
      "This week",
      "This weekend",
      "Next week",
      "Next weekend",
    ]);
    expect(quickDues("2026-11-22")).toEqual([
      ["Today", { dueFrom: null, dueDate: "2026-11-22" }],
      ["Tomorrow", { dueFrom: null, dueDate: "2026-11-23" }],
      ["Next week", span("2026-11-23", "2026-11-29")],
      ["Next weekend", span("2026-11-28", "2026-11-29")],
    ]);
    // Monday starts a new week, across a month end.
    expect(quickDues("2026-11-30")[2]).toEqual(["This week", span("2026-11-30", "2026-12-06")]);
  });

  it("reads typed due days, looking ahead from the app's today", () => {
    const wed = "2026-11-18";
    // The quick buttons' names set what the buttons do: chrono alone reads
    // "next week" as today + 7 (the 25th), the button as Monday to Sunday.
    expect(parseDue(" Next week ", wed)).toEqual({ dueFrom: "2026-11-23", dueDate: "2026-11-29" });
    expect(parseDue("next weekend", wed)).toEqual({ dueFrom: "2026-11-28", dueDate: "2026-11-29" });
    expect(parseDue("this week", wed)).toEqual({ dueFrom: "2026-11-16", dueDate: "2026-11-22" });
    expect(parseDue("weekend", wed)).toEqual({ dueFrom: "2026-11-21", dueDate: "2026-11-22" });
    expect(parseDue("tomorrow", wed)).toEqual(day("2026-11-19"));
    expect(parseDue("mon", wed)).toEqual(day("2026-11-23")); // not the past Monday
    expect(parseDue("fri", wed)).toEqual(day("2026-11-20"));
    expect(parseDue("in 2 weeks", wed)).toEqual(day("2026-12-02"));
    expect(parseDue("nov 27", wed)).toEqual(day("2026-11-27"));
    expect(parseDue("3 jan", "2026-12-10")).toEqual(day("2027-01-03"));
    expect(parseDue("end of month", wed)).toEqual(day("2026-11-30"));
    // On a Friday, "fri" is next week's: chrono alone gives today. A date
    // that happens to be today, or "this fri", still means today.
    const fri = "2026-11-20";
    expect(parseDue("fri", fri)).toEqual(day("2026-11-27"));
    expect(parseDue("on Friday", fri)).toEqual(day("2026-11-27"));
    expect(parseDue("this fri", fri)).toEqual(day(fri));
    expect(parseDue("20 nov", fri)).toEqual(day(fri));
    expect(parseDue("fri 20 nov", fri)).toEqual(day(fri));
    expect(parseDue("next fri", fri)).toEqual(day("2026-11-27"));
    expect(parseDue("hello", wed)).toBeNull();
    expect(parseDue("  ", wed)).toBeNull();
    // Object.prototype's names aren't quick-button names.
    expect(parseDue("constructor", wed)).toBeNull();
    expect(parseDue("__proto__", wed)).toBeNull();
  });

  it("reads numeric due days in the locale's order", () => {
    const wed = "2026-11-18";
    const parts = Intl.DateTimeFormat.prototype.formatToParts;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    try {
      spy.mockImplementation(function (this: Intl.DateTimeFormat, d) {
        return parts.call(new Intl.DateTimeFormat("en-US"), d);
      });
      expect(parseDue("1/12", wed)).toEqual(day("2027-01-12"));
      spy.mockImplementation(function (this: Intl.DateTimeFormat, d) {
        return parts.call(new Intl.DateTimeFormat("en-GB"), d);
      });
      expect(parseDue("1/12", wed)).toEqual(day("2026-12-01"));
      // Day-first must not swallow month-name dates: "nov 27" isn't Nov 2027.
      expect(parseDue("nov 27", wed)).toEqual(day("2026-11-27"));
    } finally {
      spy.mockRestore();
    }
  });

  it("labels due days relative to today", () => {
    const today = "2026-11-14"; // a Saturday
    expect(dueLabel("2026-11-14", today)).toBe("Today");
    expect(dueLabel("2026-11-15", today)).toBe("Tomorrow");
    expect(dueLabel("2026-11-13", today)).toBe("Yesterday");
    // Further out it's the runtime's locale, so build the expected text the same way.
    const utc = { timeZone: "UTC" } as const;
    expect(dueLabel("2026-11-20", today)).toBe(
      new Date(Date.UTC(2026, 10, 20)).toLocaleDateString(undefined, { ...utc, weekday: "short" }),
    );
    expect(dueLabel("2026-11-21", today)).toBe(
      new Date(Date.UTC(2026, 10, 21)).toLocaleDateString(undefined, {
        ...utc,
        day: "numeric",
        month: "short",
      }),
    );
    expect(dueLabel("2027-01-05", today)).toBe(
      new Date(Date.UTC(2027, 0, 5)).toLocaleDateString(undefined, {
        ...utc,
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    );
    // A span: this, next and last week or weekend by name, else its dates.
    expect(dueLabel("2026-11-15", today, "2026-11-09")).toBe("This week");
    expect(dueLabel("2026-11-15", today, "2026-11-14")).toBe("This weekend");
    expect(dueLabel("2026-11-22", today, "2026-11-16")).toBe("Next week");
    expect(dueLabel("2026-11-22", today, "2026-11-21")).toBe("Next weekend");
    expect(dueLabel("2026-11-08", today, "2026-11-02")).toBe("Last week");
    expect(dueLabel("2026-11-08", today, "2026-11-07")).toBe("Last weekend");
    // Two weeks on, or Monday to Wednesday, isn't a named week.
    for (const [from, to] of [["2026-11-23", "2026-11-29"], ["2026-11-16", "2026-11-18"]]) {
      expect(dueLabel(to, today, from)).toBe(
        new Intl.DateTimeFormat(undefined, { ...utc, day: "numeric", month: "short" }).formatRange(
          new Date(`${from}T00:00Z`),
          new Date(`${to}T00:00Z`),
        ),
      );
    }
  });

  it("puts open due-or-overdue items, and ones finished today, on Today", () => {
    const today = "2026-11-14";
    const tz = "Europe/London";
    const doneToday = Date.UTC(2026, 10, 14, 10);
    const doneYesterday = Date.UTC(2026, 10, 13, 10);
    expect(isOnToday({ dueDate: "2026-11-14", completedAt: null }, today, tz)).toBe(true);
    expect(isOnToday({ dueDate: "2026-11-02", completedAt: null }, today, tz)).toBe(true);
    expect(isOnToday({ dueDate: "2026-11-15", completedAt: null }, today, tz)).toBe(false);
    expect(isOnToday({ dueDate: null, completedAt: null }, today, tz)).toBe(false);
    expect(isOnToday({ dueDate: "2026-11-10", completedAt: doneToday }, today, tz)).toBe(true);
    expect(isOnToday({ dueDate: "2026-11-10", completedAt: doneYesterday }, today, tz)).toBe(false);
    // A span is on Today from its first day, not only once it's overdue.
    const span = (dueFrom: string, dueDate: string) => ({ dueFrom, dueDate, completedAt: null });
    expect(isOnToday(span("2026-11-09", "2026-11-15"), today, tz)).toBe(true);
    expect(isOnToday(span("2026-11-14", "2026-11-15"), today, tz)).toBe(true);
    expect(isOnToday(span("2026-11-15", "2026-11-16"), today, tz)).toBe(false);
  });
});
