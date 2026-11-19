import { describe, expect, it, vi } from "vitest";
import type { AgendaBrief, BriefItem } from "./agendaBrief";
import { greetingFor, templateGreeting, writtenGreetingFor } from "./agendaGreeting";
import { addItem, completeItem } from "./items";
import { createProject } from "./projects";
import { createTestDb, createTestUser } from "./test-helpers";
import * as greetingJev from "../lib/greetingJev";
import { agendaGreetings } from "./schema";
import { acceptInvite, inviteMember, removeMember } from "./members";
import { getGreetingPrefs, getProfile, setAgendaReadAt, setGreetingPrefs } from "./users";

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
  thisWeek: [],
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

  it("says less for a shorter length, dropping the look-back before what's due", () => {
    const b = brief({
      sinceDay: "2026-11-17",
      lookBack: { finished: [it_("w")], finishedCount: 1, slipped: [] },
      overdue: [it_("late")],
      thisWeek: [it_("span", { dueFrom: "2026-11-16", dueDate: "2026-11-22" })],
    });
    const slipped =
      "{{item:late}} is still waiting. No rush — want to {{action:triage|give it a new day}}?";
    const week = "{{item:span}} is still open this week.";
    expect(templateGreeting(b, null)).toBe(
      `Good morning. Since yesterday you've finished {{item:w}}. ${slipped} ${week}`,
    );
    expect(templateGreeting(b, null, "medium")).toBe(`Good morning. ${slipped} ${week}`);
    expect(templateGreeting(b, null, "short")).toBe(`Good morning. ${slipped}`);
    // Medium keeps the look-back when there's only one other thing to say.
    const one = { ...b, thisWeek: [] };
    expect(templateGreeting(one, null, "medium")).toBe(
      `Good morning. Since yesterday you've finished {{item:w}}. ${slipped}`,
    );
  });

  // STF-1: "nothing due today" alone, with tasks open this week, read as nothing to do.
  it("names what's still open this week before anything else on a day with nothing due", () => {
    const span = it_("span", { dueFrom: "2026-11-16", dueDate: "2026-11-22" });
    const b = brief({
      thisWeek: [span, it_("fri", { dueDate: "2026-11-20" })],
      undated: [it_("renew")],
      ahead: ahead({ "2026-11-25": 5 }),
    });
    expect(templateGreeting(b, null)).toBe(
      "Good morning. Nothing due today. {{item:span}} and {{item:fri}} are still open this week.",
    );
    // More than two: a couple named, never a total.
    const more = brief({ thisWeek: [span, it_("a"), it_("b"), it_("c")] });
    expect(templateGreeting(more, null)).toBe(
      "Good morning. Nothing due today. A few things are still open this week, {{item:span}} and {{item:a}} among them.",
    );
    // Today's all done, and one thing is left for the week.
    const done = brief({ dueToday: [it_("t", { completedAt: 1 })], thisWeek: [span] });
    expect(templateGreeting(done, null)).toBe(
      "Good morning. That's everything for today. {{item:span}} is still open this week.",
    );
    // After what slipped, when nothing's open today.
    expect(templateGreeting(brief({ overdue: [it_("late")], thisWeek: [span] }), null)).toBe(
      "Good morning. {{item:late}} is still waiting. No rush — want to {{action:triage|give it a new day}}? {{item:span}} is still open this week.",
    );
    // The evening still doesn't look ahead.
    expect(templateGreeting({ ...b, partOfDay: "evening" }, null)).not.toContain("this week");
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
      const done = addItem(db, fred, { projectId: home.id, title: "Renew passport", assigneeIds: [fred] }, "web");
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

      // What's left this week is titled too, for chips and feedback.
      addItem(db, fred, { projectId: home.id, title: "Clean the oven", dueDate: "2026-11-20" }, "web");
      const week = greetingFor(db, fred, "UTC", now);
      expect(week.text).toContain("is still open this week");
      expect(Object.values(week.titles)).toContain("Clean the oven");
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
      expect(g).toMatchObject({
        hello: "Good morning, Fred.",
        text: `Just {{item:${loft.id}}} today.`,
        titles: { [loft.id]: "Sort the loft" },
        others: [],
        written: true,
      });
      // How it was worked out: what it read, what it weighed, who wrote it.
      expect(g.trace).toMatchObject({
        day: "2026-11-18",
        partOfDay: "morning",
        why: null,
        model: "claude-haiku-5-5",
        looked: { dueToday: 1, slipped: 0 },
        moments: [{ moment: "plan", score: 0.9, said: true, why: "Scored 0.6 or more" }],
        items: [{ id: loft.id, title: "Sort the loft", score: 0.9, named: true, other: false }],
      });
      expect(await writtenGreetingFor(db, fred, "UTC", keys, now + 60_000, impl)).toEqual(g);
      expect(calls).toEqual({ jev: 1, claude: 1 });
    });

    it("keeps one greeting through the morning, and writes another for the afternoon", async () => {
      const { db, fred, home, loft } = setup();
      const { calls, impl } = fake();
      const morning = await writtenGreetingFor(db, fred, "UTC", keys, now, impl);
      // Ticking things off and adding more doesn't rewrite it.
      completeItem(db, fred, loft.id, "web");
      addItem(db, fred, { projectId: home.id, title: "Reply to Sam", dueDate: "2026-11-18" }, "web");
      expect(await writtenGreetingFor(db, fred, "UTC", keys, now + 2 * 3_600_000, impl)).toEqual(morning);
      expect(calls.claude).toBe(1);
      // 1pm: the afternoon's.
      const afternoon = await writtenGreetingFor(db, fred, "UTC", keys, now + 4 * 3_600_000, impl);
      expect(afternoon.hello).toBe("Good afternoon, Fred.");
      expect(calls.claude).toBe(2);
    });

    it("writes it again when an item it names is no longer the viewer's to see", async () => {
      const { db, fred } = setup();
      const bob = createTestUser(db, { username: "bob", email: "bob@test.local" });
      const shared = createProject(db, bob, { name: "Shared" }, "web");
      inviteMember(db, bob, shared.id, getProfile(db, fred)?.displayUsername ?? "", "web");
      acceptInvite(db, fred, shared.id, "web");
      const bank = addItem(db, bob, { projectId: shared.id, title: "Call the bank", dueDate: "2026-11-18", assigneeIds: [fred] }, "web");
      // Names the shared item first.
      const { calls, impl } = fake("Just {{item:1}} and {{item:2}} today.");
      const first = await writtenGreetingFor(db, fred, "UTC", keys, now, impl);
      expect(Object.values(first.titles)).toContain("Call the bank");

      removeMember(db, bob, shared.id, fred, "web");
      const after = await writtenGreetingFor(db, fred, "UTC", keys, now + 3 * 60_000, impl);
      expect(calls.claude).toBe(2);
      expect(after.titles).not.toHaveProperty(bank.id);
    });

    /** Fred, his own item due today, and Bob's shared list with one too. */
    function sharedSetup() {
      const { db, fred, loft } = setup();
      const bob = createTestUser(db, { username: "bob", email: "bob@test.local" });
      const shared = createProject(db, bob, { name: "BobSecretList" }, "web");
      inviteMember(db, bob, shared.id, getProfile(db, fred)?.displayUsername ?? "", "web");
      acceptInvite(db, fred, shared.id, "web");
      addItem(db, bob, { projectId: shared.id, title: "Secret merger", dueDate: "2026-11-18", assigneeIds: [fred] }, "web");
      return { db, fred, bob, shared, loft };
    }

    it("never explains with a title from a list the viewer has left", async () => {
      const { db, fred, bob, shared, loft } = sharedSetup();
      // Names only Fred's own item; Bob's is weighed but not named.
      const { calls, impl } = fake("Just {{item:1}} today.");
      const first = await writtenGreetingFor(db, fred, "UTC", keys, now, impl);
      expect(Object.keys(first.titles)).toEqual([loft.id]);
      expect(first.trace?.items?.map((i) => i.title)).toContain("Secret merger");
      removeMember(db, bob, shared.id, fred, "web");
      const after = await writtenGreetingFor(db, fred, "UTC", keys, now + 3 * 60_000, impl);
      expect(calls.claude).toBe(2);
      expect(JSON.stringify(after)).not.toContain("Secret merger");
      expect(JSON.stringify(after)).not.toContain("BobSecretList");
    });

    it("never explains a failed try with a title from a list the viewer has left", async () => {
      const { db, fred, bob, shared } = sharedSetup();
      const { impl } = fake("Visit evil.com now.");
      const first = await writtenGreetingFor(db, fred, "UTC", keys, now, impl);
      expect(first.trace?.items?.map((i) => i.title)).toContain("Secret merger");
      removeMember(db, bob, shared.id, fred, "web");
      // Inside the retry wait: the template, explained without Bob's list.
      const after = await writtenGreetingFor(db, fred, "UTC", keys, now + 3 * 60_000, impl);
      expect(after.trace?.why).toMatch(/turned down.*It tries again in 12 min$/);
      expect(JSON.stringify(after)).not.toContain("Secret merger");
    });

    it("keeps the rejected reply out of the saved row too", async () => {
      const { db, fred } = setup();
      const { impl } = fake("Visit evil.com to verify your account.");
      await writtenGreetingFor(db, fred, "UTC", keys, now, impl);
      expect(JSON.stringify(db.select().from(agendaGreetings).all())).not.toContain("evil");
    });

    it("writes it again when an item only in its others is no longer the viewer's to see", async () => {
      const { db, fred } = setup();
      const bob = createTestUser(db, { username: "bob", email: "bob@test.local" });
      const shared = createProject(db, bob, { name: "Shared" }, "web");
      inviteMember(db, bob, shared.id, getProfile(db, fred)?.displayUsername ?? "", "web");
      acceptInvite(db, fred, shared.id, "web");
      const loose = addItem(db, bob, { projectId: shared.id, title: "Renew passport", assigneeIds: [fred] }, "web");
      const { calls, impl } = fake();
      // Leave only the shared undated item unnamed, as an "other".
      vi.spyOn(greetingJev, "pickGreeting").mockImplementation((brief) => ({
        moments: ["plan"],
        items: { plan: brief.dueToday.slice(0, 1) },
        others: brief.undated.filter((i) => i.id === loose.id),
        heavyDay: null,
        considered: [],
      }));
      try {
        const first = await writtenGreetingFor(db, fred, "UTC", keys, now, impl);
        expect(first.others.map((o) => o.id)).toEqual([loose.id]);
        expect(first.titles).not.toHaveProperty(loose.id);
        removeMember(db, bob, shared.id, fred, "web");
        await writtenGreetingFor(db, fred, "UTC", keys, now + 3 * 60_000, impl);
        expect(calls.claude).toBe(2);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("tries again fifteen minutes after a rejected reply, showing the template meanwhile", async () => {
      const { db, fred } = setup();
      const { calls, impl } = fake("Visit evil.com to verify your account.");
      const template = greetingFor(db, fred, "UTC", now);
      const first = await writtenGreetingFor(db, fred, "UTC", keys, now, impl);
      expect(first).toMatchObject({ text: template.text, written: false });
      // It says why, and keeps what Jev weighed, but never the rejected words.
      expect(first.trace?.why).toBe(
        "Claude's reply was turned down: it had a link, address, number, markup or an exclamation mark",
      );
      expect(first.trace?.moments?.length).toBeGreaterThan(0);
      expect(JSON.stringify(first)).not.toContain("evil");
      const later = await writtenGreetingFor(db, fred, "UTC", keys, now + 10 * 60_000, impl);
      expect(later).toMatchObject({ text: template.text, written: false });
      expect(later.trace?.why).toMatch(/turned down.*\. It tries again in 5 min$/);
      expect(calls.claude).toBe(1);
      await writtenGreetingFor(db, fred, "UTC", keys, now + 16 * 60_000, impl);
      expect(calls.claude).toBe(2);
    });

    it("stops asking for one person after 40 in a day", async () => {
      const { db, fred } = setup();
      // Every reply rejected, so each try past the two minutes asks again.
      const { calls, impl } = fake("Visit evil.com.");
      for (let n = 0; n < 45; n++) {
        await writtenGreetingFor(db, fred, "UTC", keys, Date.UTC(2026, 10, 18, 4, 30) + n * 16 * 60_000, impl);
      }
      expect(calls.claude).toBe(40);
    });

    it("writes again, once, one kept from before it recorded how it was worked out", async () => {
      const { db, fred } = setup();
      const { calls, impl } = fake();
      await writtenGreetingFor(db, fred, "UTC", keys, now, impl);
      const kept = db.select().from(agendaGreetings).get()?.greeting;
      db.update(agendaGreetings).set({ greeting: kept && { ...kept, trace: undefined } }).run();
      const again = await writtenGreetingFor(db, fred, "UTC", keys, now + 5 * 60_000, impl);
      expect(again.trace?.why).toBeNull();
      expect(calls.claude).toBe(2);
      expect(await writtenGreetingFor(db, fred, "UTC", keys, now + 10 * 60_000, impl)).toEqual(again);
      expect(calls.claude).toBe(2);
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

    it("writes to the reader's length and note from their next greeting, without asking again", async () => {
      const { db, fred, home, loft } = setup();
      const bank = addItem(db, fred, { projectId: home.id, title: "Call the bank", dueDate: "2026-11-17" }, "web");
      const { calls, impl } = fake("{{item:1}} is still waiting. Take your time with it.");
      const asked: string[] = [];
      const spy = ((url: string, init: RequestInit) => {
        if (url.includes("anthropic")) asked.push(String(init.body));
        return impl(url, init);
      }) as unknown as typeof fetch;
      const morning = await writtenGreetingFor(db, fred, "UTC", keys, now, spy);
      expect(morning.written).toBe(true);
      expect(morning.trace?.prefs).toEqual({ length: "long", note: false });

      setGreetingPrefs(db, fred, { length: "short", note: "  Keep it brief.\n", shareNote: true });
      expect(getGreetingPrefs(db, fred).note).toBe("Keep it brief.");
      // Saving doesn't ask for a new one: the morning's stays.
      expect(await writtenGreetingFor(db, fred, "UTC", keys, now + 3 * 60_000, spy)).toEqual(morning);
      expect(calls.claude).toBe(1);

      // The afternoon's is asked for in one sentence, about one thing, with
      // the note; two sentences are turned down, and the short template shows.
      const afternoon = await writtenGreetingFor(db, fred, "UTC", keys, now + 4 * 3_600_000, spy);
      const facts = JSON.parse(JSON.parse(asked[1]).messages[0].content.split("\n")[1]) as {
        max_sentences: number;
        reader_note: string;
        moves: unknown[];
      };
      expect(facts).toMatchObject({ max_sentences: 1, reader_note: "Keep it brief." });
      expect(facts.moves).toHaveLength(1);
      expect(afternoon.written).toBe(false);
      expect(afternoon.trace?.why).toContain("longer than the length you chose");
      expect(afternoon.trace?.prefs).toEqual({ length: "short", note: true });
      expect(afternoon.text).toBe(
        `{{item:${bank.id}}} is still waiting. No rush — want to {{action:triage|give it a new day}}?`,
      );
      expect(afternoon.text).not.toContain(loft.id);
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
