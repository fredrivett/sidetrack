import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  dayLabel,
  dayOf,
  dueLabel,
  isDay,
  isOnToday,
  nextDayStart,
  startOfDay,
  thisWeekend,
} from "./time";

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

  it("picks this weekend", () => {
    expect(thisWeekend("2026-11-18")).toBe("2026-11-21"); // Wed → Sat
    expect(thisWeekend("2026-11-21")).toBe("2026-11-21"); // Sat → today
    expect(thisWeekend("2026-11-22")).toBe("2026-11-22"); // Sun → today
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
  });
});
