import { describe, expect, it } from "vitest";
import { ruleNewDays, suggestNewDays, type LeftItem } from "./newDays";

// Thursday 26 November 2026; the week ahead starts Friday.
const today = "2026-11-26";
const ahead = [
  { day: "2026-11-27", open: 5 },
  { day: "2026-11-28", open: 1 },
  { day: "2026-11-29", open: 0 },
  { day: "2026-11-30", open: 4 },
];
const item = (id: string, dueDate = today): LeftItem => ({ id, title: `Task ${id}`, context: "Home", dueDate });

describe("ruleNewDays", () => {
  it("puts what slipped tomorrow, however full, and today's on the lightest day, counting each placed", () => {
    const days = ruleNewDays([item("a", "2026-11-23"), item("b"), item("c"), item("d")], ahead, today);
    expect(days.map((d) => d.day)).toEqual(["2026-11-27", "2026-11-29", "2026-11-28", "2026-11-29"]);
    expect(days[0].why).toBe("Slipped since Monday, so tomorrow");
    expect(days[1].why).toBe("Tomorrow has 6, Sunday is lighter");
  });

  it("says only that a long-slipped item slipped a while ago", () => {
    const [d] = ruleNewDays([item("a", "2026-11-16")], ahead, today);
    expect(d.why).toBe("Slipped a while ago, so tomorrow");
  });

  it("keeps today's for tomorrow while it has room", () => {
    const [d] = ruleNewDays([item("a")], [{ day: "2026-11-27", open: 3 }, ...ahead.slice(1)], today);
    expect(d).toEqual({ id: "a", day: "2026-11-27", why: "Tomorrow has room" });
  });
});

describe("suggestNewDays", () => {
  const answering = (days: unknown) =>
    (async () =>
      new Response(
        JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ days }) }] }),
      )) as unknown as typeof fetch;

  it("keeps Claude's checked days and falls back to the rules for the rest", async () => {
    const items = [item("a"), item("b"), item("c"), item("d")];
    const days = await suggestNewDays(
      items,
      ahead,
      today,
      "key",
      answering([
        { id: "a", day: "2026-11-30", why: "can wait,  and Monday is fine" },
        { id: "b", day: "2026-12-25", why: "Christmas" },
        { id: "c", day: "2026-11-28", why: "See <https://evil.example>" },
        { id: "zz", day: "2026-11-28", why: "Not one of theirs" },
        { id: "d", day: "2026-11-30", why: "Saturday is light" },
      ]),
    );
    const rules = ruleNewDays(items, ahead, today);
    expect(days).toEqual([{ id: "a", day: "2026-11-30", why: "Can wait, and Monday is fine" }, rules[1], rules[2], rules[3]]);
  });

  it("gives the rules' days without a key or when Claude fails", async () => {
    const items = [item("a")];
    const rules = ruleNewDays(items, ahead, today);
    expect(await suggestNewDays(items, ahead, today, undefined)).toEqual(rules);
    const failing = (async () => new Response("", { status: 529 })) as unknown as typeof fetch;
    expect(await suggestNewDays(items, ahead, today, "key", failing)).toEqual(rules);
  });
});
