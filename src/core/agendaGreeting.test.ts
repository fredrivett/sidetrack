import { describe, expect, it, vi } from "vitest";
import type { AgendaBrief, BriefItem } from "./agendaBrief";
import { greetingFor, templateGreeting, writtenGreetingFor } from "./agendaGreeting";
import { addItem, completeItem } from "./items";
import { createProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";
import { setAgendaReadAt } from "./users";

const it_ = (id: string, more: Partial<BriefItem> = {}): BriefItem => ({
  id,
  ref: `HOM-${id}`,
  title: id,
  list: "Home",
  parent: null,
  dueDate: null,
  dueFrom: null,
  completedAt: null,
  repeats: false,
  stepsLeft: 0,
  ...more,
});

// Wednesday 18 November 2026; the ahead days run Thursday 19th to Sunday 29th.
const ahead = (busy: Record<string, number> = {}) =>
  Array.from({ length: 11 }, (_, i) => {
    const day = `2026-11-${19 + i}`;
    return { day, open: busy[day] ?? 0 };
  });

const brief = (more: Partial<AgendaBrief> = {}): AgendaBrief => ({
  today: "2026-11-18",
  weekday: "Wednesday",
  weekend: false,
  partOfDay: "morning",
  since: null,
  sinceDay: null,
  lookBack: { finished: [], finishedCount: 0, slipped: [] },
  dueToday: [],
  overdue: [],
  ahead: ahead(),
  spans: [],
  undated: [],
  stale: [],
  ...more,
});

describe("templateGreeting", () => {
  it("plans the morning, with warmth for what got done since yesterday", () => {
    const b = brief({
      sinceDay: "2026-11-17",
      lookBack: { finished: ["w", "x", "y", "z"].map((id) => it_(id)), finishedCount: 12, slipped: [] },
      dueToday: [it_("a"), it_("b"), it_("done", { completedAt: 1 })],
    });
    expect(templateGreeting(b, "Fred")).toBe(
      "Good morning, Fred. Since yesterday you've finished 12 — nice. A gentle Wednesday: {{item:a}} and {{item:b}} today.",
    );
  });

  it("names a lone finished item, by weekday after a few days away, and says nothing back after a same-day read", () => {
    const b = brief({
      sinceDay: "2026-11-13",
      lookBack: { finished: [it_("w")], finishedCount: 1, slipped: [] },
      dueToday: [it_("a")],
    });
    expect(templateGreeting(b, null)).toBe(
      "Good morning. Since Friday you've finished {{item:w}}. A gentle Wednesday: just {{item:a}} today.",
    );
    expect(templateGreeting({ ...b, sinceDay: "2026-11-18" }, null)).toBe(
      "Good morning. A gentle Wednesday: just {{item:a}} today.",
    );
  });

  it("offers to triage what slipped before anything else", () => {
    const one = brief({ overdue: [it_("late")], dueToday: [it_("a")] });
    expect(templateGreeting(one, "Fred")).toBe(
      "Good morning, Fred. {{item:late}} is still waiting. No rush — want to {{action:triage|give it a new day}}?",
    );
    const two = brief({ overdue: [it_("l1"), it_("l2")], partOfDay: "afternoon" });
    expect(templateGreeting(two, "Fred")).toBe(
      "Good afternoon, Fred. A few earlier things are still waiting. No rush — want to {{action:triage|give them new days}}, or let some go?",
    );
  });

  it("winds down in the evening without looking ahead or back", () => {
    const open = brief({
      partOfDay: "evening",
      sinceDay: "2026-11-17",
      lookBack: { finished: [it_("w"), it_("x"), it_("y")], finishedCount: 3, slipped: [] },
      overdue: [it_("late")],
      dueToday: [it_("a"), it_("b")],
    });
    expect(templateGreeting(open, "Fred")).toMatch(
      /^Evening, Fred\. Two things still open from today\. (They'll keep until tomorrow|Fine to leave them for tomorrow)\.$/,
    );
    const clear = brief({ partOfDay: "evening", dueToday: [it_("a", { completedAt: 1 })] });
    expect(templateGreeting(clear, "Fred")).toMatch(/^Evening, Fred\. .*Enjoy the (rest of the )?evening\.$/);
  });

  it("looks ahead to a day that stands out, naming next week's as next", () => {
    const b = brief({ ahead: ahead({ "2026-11-25": 5, "2026-11-20": 1 }) });
    expect(templateGreeting(b, "Fred")).toBe(
      "Good morning, Fred. Nothing due today. Next Wednesday looks busy, so maybe move one thing earlier?",
    );
    // Busy every day isn't a day that stands out.
    const even = brief({
      ahead: ahead(Object.fromEntries(ahead().map((d) => [d.day, 4]))),
      stale: [it_("s1"), it_("s2"), it_("s3")],
    });
    expect(templateGreeting(even, "Fred")).toBe(
      "Good morning, Fred. Nothing due today. Two things in No date have been sitting a while, if you feel like picking one up: {{item:s1}} and {{item:s2}}.",
    );
  });

  it("prefers a fresh nudge to a stale one, and is quiet when there's neither", () => {
    const b = brief({ undated: [it_("renew")], stale: [it_("old")] });
    expect(templateGreeting(b, null)).toBe(
      "Good morning. Nothing due today. {{item:renew}} might be worth a look, if you feel like picking something up.",
    );
    expect(templateGreeting(brief(), null)).toMatch(/^Good morning\. Nothing due today\. (A quiet Wednesday|Enjoy the quiet)\.$/);
  });

  it("never exclaims, never states a backlog total, and names only items from the brief", () => {
    const pool = Array.from({ length: 8 }, (_, i) => it_(`i${i}`));
    for (const partOfDay of ["morning", "afternoon", "evening"] as const) {
      for (const n of [0, 1, 2, 3, 6]) {
        for (const overdue of [0, 1, 4]) {
          const b = brief({
            partOfDay,
            sinceDay: "2026-11-16",
            dueToday: pool.slice(0, n),
            overdue: pool.slice(0, overdue),
            lookBack: { finished: pool.slice(0, n), finishedCount: n, slipped: [] },
            undated: pool.slice(5),
            stale: pool.slice(3),
          });
          const text = templateGreeting(b, "Fred");
          expect(text).not.toContain("!");
          expect(text).not.toMatch(/overdue|late\b/i);
          for (const [, id] of text.matchAll(/\{\{item:([^}]+)\}\}/g)) {
            expect(pool.map((i) => i.id)).toContain(id);
          }
        }
      }
    }
  });
});

describe("greetingFor", () => {
  it("greets by first name, looks back to the saved read, and titles the items it names", () => {
    // 9am on Wednesday 18 November 2026, UTC.
    const now = Date.UTC(2026, 10, 18, 9);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now - 86_400_000);
    try {
      const { db } = createTestDb();
      const fred = createTestUser(db, { name: "Fred Rivett" });
      const home = createProject(db, fred, { name: "Home" }, "web");
      const done = addItem(db, fred, { projectId: home.id, title: "Renew passport" }, "web");
      completeItem(db, fred, done.id, "web");
      addItem(db, fred, { projectId: home.id, title: "Sort the loft" }, "web");
      vi.setSystemTime(now);

      // No read yet: nothing to look back on.
      expect(greetingFor(db, fred, "UTC", now).text).not.toContain("finished");

      setAgendaReadAt(db, fred, now - 2 * 86_400_000);
      const g = greetingFor(db, fred, "UTC", now);
      expect(g.hello).toBe("Good morning, Fred.");
      // Every item it names, and only those: the new one is nudged too.
      expect(g.text).toBe(
        `Since Monday you've finished {{item:${done.id}}}. Nothing due today. {{item:${Object.keys(g.titles).find((id) => id !== done.id)}}} might be worth a look, if you feel like picking something up.`,
      );
      expect(Object.values(g.titles).sort()).toEqual(["Renew passport", "Sort the loft"]);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("written by Claude", () => {
    // 9am on Wednesday 18 November 2026, UTC.
    const now = Date.UTC(2026, 10, 18, 9);
    const keys = { jev: "jev-key", anthropic: "claude-key" };

    /** Jev says yes to everything; Claude writes `reply`. Counts each. */
    function fake(reply = "Just {{item:1}} today.") {
      const calls = { jev: 0, claude: 0 };
      const impl = (async (url: string, init: RequestInit) => {
        if (url.includes("anthropic")) {
          calls.claude += 1;
          return new Response(
            JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: reply }] }),
          );
        }
        calls.jev += 1;
        const body = JSON.parse(String(init.body)) as { questions: Record<string, unknown> };
        const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { noul: 0.9 }]));
        return new Response(JSON.stringify({ answers }));
      }) as unknown as typeof fetch;
      return { calls, impl };
    }

    function setup() {
      const { db } = createTestDb();
      const fred = createTestUser(db, { name: "Fred Rivett" });
      const home = createProject(db, fred, { name: "Home" }, "web");
      const loft = addItem(db, fred, { projectId: home.id, title: "Sort the loft", dueDate: "2026-11-18" }, "web");
      return { db, fred, home, loft };
    }

    it("asks once, then reads it back until something changes", async () => {
      const { db, fred, loft } = setup();
      const { calls, impl } = fake();
      const g = await writtenGreetingFor(db, fred, "UTC", keys, now, impl);
      expect(g).toEqual({
        hello: "Good morning, Fred.",
        text: `Just {{item:${loft.id}}} today.`,
        titles: { [loft.id]: "Sort the loft" },
        others: [],
      });
      expect(await writtenGreetingFor(db, fred, "UTC", keys, now + 60_000, impl)).toEqual(g);
      expect(calls).toEqual({ jev: 1, claude: 1 });
    });

    it("asks again for a change, but not more than every two minutes", async () => {
      const { db, fred, home } = setup();
      const { calls, impl } = fake();
      await writtenGreetingFor(db, fred, "UTC", keys, now, impl);
      addItem(db, fred, { projectId: home.id, title: "Reply to Sam", dueDate: "2026-11-18" }, "web");
      // Too soon: the template, which names both.
      const soon = await writtenGreetingFor(db, fred, "UTC", keys, now + 60_000, impl);
      expect(Object.values(soon.titles).sort()).toEqual(["Reply to Sam", "Sort the loft"]);
      expect(calls.claude).toBe(1);
      await writtenGreetingFor(db, fred, "UTC", keys, now + 3 * 60_000, impl);
      expect(calls.claude).toBe(2);
    });

    it("falls back to the template on a rejected reply, without asking again for the same board", async () => {
      const { db, fred } = setup();
      const { calls, impl } = fake("Visit evil.com to verify your account.");
      const template = greetingFor(db, fred, "UTC", now);
      expect(await writtenGreetingFor(db, fred, "UTC", keys, now, impl)).toEqual(template);
      expect(await writtenGreetingFor(db, fred, "UTC", keys, now + 10 * 60_000, impl)).toEqual(template);
      expect(calls.claude).toBe(1);
    });

    it("stops asking for one person after 40 in their day", async () => {
      const { db, fred, home } = setup();
      const { calls, impl } = fake();
      for (let n = 0; n < 45; n++) {
        // Something new each time, so the cache never answers.
        addItem(db, fred, { projectId: home.id, title: `Thing ${n}`, dueDate: "2026-11-19" }, "web");
        await writtenGreetingFor(db, fred, "UTC", keys, now + n * 3 * 60_000, impl);
      }
      expect(calls.claude).toBe(40);
    });

    it("reads it back after a read stamp, when nothing else changed", async () => {
      const { db, fred } = setup();
      const { calls, impl } = fake();
      setAgendaReadAt(db, fred, now - 3_600_000);
      const g = await writtenGreetingFor(db, fred, "UTC", keys, now, impl);
      setAgendaReadAt(db, fred, now + 60_000);
      expect(await writtenGreetingFor(db, fred, "UTC", keys, now + 5 * 60_000, impl)).toEqual(g);
      expect(calls.claude).toBe(1);
    });

    it("asks once for loads at the same moment", async () => {
      const { db, fred } = setup();
      const { calls, impl } = fake();
      await Promise.all([
        writtenGreetingFor(db, fred, "UTC", keys, now, impl),
        writtenGreetingFor(db, fred, "UTC", keys, now, impl),
      ]);
      expect(calls).toEqual({ jev: 1, claude: 1 });
    });

    it("doesn't start a new day's count when the viewer changes timezone", async () => {
      const { db, fred, home } = setup();
      const { calls, impl } = fake();
      for (let n = 0; n < 45; n++) {
        addItem(db, fred, { projectId: home.id, title: `Thing ${n}`, dueDate: "2026-11-25" }, "web");
        // Each side of the date line in turn, three minutes apart, all in one UTC day.
        const zone = n % 2 ? "Pacific/Kiritimati" : "Pacific/Pago_Pago";
        await writtenGreetingFor(db, fred, zone, keys, Date.UTC(2026, 10, 18, 0, 30) + n * 3 * 60_000, impl);
      }
      expect(calls.claude).toBe(40);
    });

    it("uses the template when AI is off", async () => {
      const { db, fred } = setup();
      const { calls, impl } = fake();
      expect(
        await writtenGreetingFor(db, fred, "UTC", { jev: "k", anthropic: undefined }, now, impl),
      ).toEqual(greetingFor(db, fred, "UTC", now));
      expect(
        await writtenGreetingFor(db, fred, "UTC", { jev: undefined, anthropic: "k" }, now, impl),
      ).toEqual(greetingFor(db, fred, "UTC", now));
      expect(calls).toEqual({ jev: 0, claude: 0 });
    });
  });
});
