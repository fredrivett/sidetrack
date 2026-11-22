import { describe, expect, it } from "vitest";
import { checkParts } from "./titleParse";

// A Wednesday.
const ctx = { today: "2026-11-18", lists: [], labels: [], people: [] };
const part = (text: string, value: string, before = false, remove = !before) => ({
  text,
  field: "due",
  value,
  remove,
  before,
});
const dues = (title: string, ...parts: ReturnType<typeof part>[]) =>
  checkParts({ parts }, title, ctx).map((p) => (p.field === "due" ? p.due : null));

describe("checkParts' due dates", () => {
  it("makes a date something is for due the day before, but never before today", () => {
    expect(dues("buy breakfast for tomorrow", part("for tomorrow", "2026-11-19", true))).toEqual([
      { dueFrom: null, dueDate: "2026-11-18" },
    ]);
    expect(dues("Get wine for Saturday's party", part("Saturday's", "2026-11-21", true))).toEqual([
      { dueFrom: null, dueDate: "2026-11-20" },
    ]);
    expect(dues("Pack for today's trip", part("today's", "2026-11-18", true))).toEqual([
      { dueFrom: null, dueDate: "2026-11-18" },
    ]);
  });

  it("takes a date to do it on as it is, and a week as a span", () => {
    expect(dues("add wash clothes to tuesday", part("to tuesday", "2026-11-24"))).toEqual([
      { dueFrom: null, dueDate: "2026-11-24" },
    ]);
    expect(dues("Do taxes next week", part("next week", "2026-11-23/2026-11-29"))).toEqual([
      { dueFrom: "2026-11-23", dueDate: "2026-11-29" },
    ]);
  });

  it("keeps the words of a date something is rescheduled to, whatever Claude says", () => {
    const [moved] = checkParts({ parts: [part("to Friday", "2026-11-20")] }, "Push the call to Friday", ctx);
    expect(moved).toMatchObject({ text: "to Friday", remove: false });
    const [done] = checkParts({ parts: [part("to Friday", "2026-11-20")] }, "Add the call to Friday", ctx);
    expect(done).toMatchObject({ text: "to Friday", remove: true });
  });

  it("drops a date that's past, malformed, backwards or not in the title", () => {
    expect(
      dues(
        "Call mum tomorrow",
        part("tomorrow", "2026-11-17"),
        part("tomorrow", "Thursday"),
        part("tomorrow", "2026-11-29/2026-11-23"),
        part("on Friday", "2026-11-20"),
      ),
    ).toEqual([]);
  });
});
