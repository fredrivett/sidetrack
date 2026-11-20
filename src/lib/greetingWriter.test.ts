import { describe, expect, it } from "vitest";
import type { AgendaBrief, BriefItem } from "../core/agendaBrief";
import type { GreetingPick } from "./greetingJev";
import { parseGreeting } from "./greeting";
import { checkWriterOutput, writeGreeting, writerInput } from "./greetingWriter";

const item = (id: string, title: string, more: Partial<BriefItem> = {}): BriefItem => ({
  id,
  ref: `HOM-${id}`,
  title,
  list: "Home",
  parent: null,
  dueDate: null,
  dueFrom: null,
  completedAt: null,
  repeats: false,
  stepsLeft: 0,
  ...more,
});

const bank = item("k1", "Call the bank", { dueDate: "2026-11-16" });
const sam = item("s1", "Reply to Sam", { dueDate: "2026-11-18" });
const brief: AgendaBrief = {
  today: "2026-11-18",
  weekday: "Wednesday",
  weekend: false,
  partOfDay: "morning",
  since: 1,
  sinceDay: "2026-11-16",
  lookBack: { finished: [item("f1", "Fix the porch light")], finishedCount: 5, slipped: [] },
  dueToday: [sam],
  overdue: [bank],
  ahead: [],
  thisWeek: [],
  undated: [],
  stale: [],
  dayNote: null,
};
const pick: GreetingPick = {
  moments: ["triage", "plan"],
  items: { triage: [bank], plan: [sam] },
  others: [item("o1", "Sort the loft")],
  heavyDay: null,
  considered: [],
};
const input = writerInput(brief, pick);

describe("writerInput", () => {
  it("numbers each item once and names the look-back by weekday", () => {
    expect([...input.items].map(([n, i]) => [n, i.id])).toEqual([
      [1, "k1"],
      [2, "s1"],
      [3, "f1"],
    ]);
    expect(input.facts).toMatchObject({
      finished_since_last_visit: { count: 5, since: "Monday" },
      others: 1,
      slipped_total: 1,
    });
    expect(writerInput(brief, { ...pick, moments: ["plan"] }).facts).not.toHaveProperty("slipped_total");
    // Three slipped, one named: it's told three.
    const three = { ...brief, overdue: [bank, item("o2", "Bins"), item("o3", "Post")] };
    expect(writerInput(three, pick).facts).toMatchObject({ slipped_total: 3 });
  });

  it("tells it how much is left this week, and that a span is due all week", () => {
    const span = item("w1", "Clean the oven", { dueFrom: "2026-11-16", dueDate: "2026-11-22" });
    const fri = item("w2", "Book the dentist", { dueDate: "2026-11-20" });
    const week = { ...brief, dueToday: [], overdue: [], thisWeek: [span, fri, item("w3", "Post")] };
    const facts = writerInput(week, {
      ...pick,
      moments: ["week"],
      items: { week: [span, fri] },
    }).facts as { this_week_total: number; moves: Array<{ tasks: Array<{ due: string }> }> };
    expect(facts.this_week_total).toBe(3);
    expect(facts.moves[0].tasks.map((t) => t.due)).toEqual(["this week", "Friday"]);
    expect(writerInput(brief, pick).facts).not.toHaveProperty("this_week_total");
    // A span whose week has passed is due on its last day, like any slipped task.
    const lapsed = item("l1", "Old span", { dueFrom: "2026-11-09", dueDate: "2026-11-15" });
    const slipped = writerInput({ ...brief, overdue: [lapsed] }, { ...pick, items: { triage: [lapsed] } })
      .facts as { moves: Array<{ tasks: Array<{ due: string }> }> };
    expect(slipped.moves[0].tasks[0].due).toBe("Sunday");
  });
});

describe("writerInput, with the reader's settings", () => {
  it("passes on the note and caps the sentences at the chosen length", () => {
    const short = writerInput(brief, pick, { length: "short", note: "No praise.", shareNote: false });
    expect(short.facts).toMatchObject({ max_sentences: 1, reader_note: "No praise." });
    expect(input.facts).toMatchObject({ max_sentences: 3 });
    expect(input.facts).not.toHaveProperty("reader_note");
    const two = "{{item:1}} is still waiting. {{item:2}} is today's.";
    expect(checkWriterOutput(two, input)).not.toBeNull();
    expect(checkWriterOutput(two, short)).toBeNull();
    expect(checkWriterOutput("{{item:1}} is still waiting.", short)).not.toBeNull();
    expect(checkWriterOutput("{{item:1}} is still waiting, e.g. since 9 a.m. yesterday.", short)).not.toBeNull();
  });
});

describe("checkWriterOutput", () => {
  it("turns numbered tokens back into the page's tokens", () => {
    expect(
      checkWriterOutput(
        "{{item:1}} slipped past Monday. No rush — want to {{action:triage|give it a new day}}? Otherwise just {{item:2}}, ahead of {{others|one other}}.",
        input,
      ),
    ).toBe(
      "{{item:k1}} slipped past Monday. No rush — want to {{action:triage|give it a new day}}? Otherwise just {{item:s1}}, ahead of {{others|one other}}.",
    );
  });

  it.each([
    ["an item it wasn't given", "Start with {{item:9}}."],
    ["a token it doesn't know", "Start with {{item:1}} and {{link:http}}."],
    ["an action it doesn't know", "Start with {{item:1}}, or {{action:delete|clear it all}}?"],
    ["an item by its real id", "Start with {{item:k1}}."],
    ["an action with no words", "Start with {{item:1}}, or {{action:triage|   }}?"],
    ["an action with too many words", `Start with {{item:1}}, or {{action:triage|${"x".repeat(41)}}}?`],
    ["a bare domain", "Start with {{item:1}}, then visit evil.com to verify."],
    ["an email address", "Start with {{item:1}}, then write to help@x."],
    ["a phone number", "Start with {{item:1}}, then call 0800 123 456."],
    ["a malformed token", "Start with {{item:1} today."],
    ["a stray brace", "Start with {{item:1}} {today}."],
    ["a link", "Start with {{item:1}}, then see evil.example at https://evil.example."],
    ["a www address", "Start with {{item:1}} at www.evil.example."],
    ["markup", "Start with **{{item:1}}**."],
    ["an exclamation", "Start with {{item:1}}!"],
    ["a scolding word", "{{item:1}} is overdue."],
    ["calling a task late", "{{item:1}} is running late."],
    ["calling tasks late", "{{item:1}} and {{item:2}} are both a little late."],
    ["calling a task late, briefly", "{{item:1}} is late."],
    ["calling a task so late", "{{item:1}} is so late."],
    ["a title spelled out", "Call the bank, then {{item:2}}."],
    ["more than three sentences", "{{item:1}} first. Then this. Then that. And more."],
    ["no item when it was given some", "A gentle Wednesday."],
    ["nothing", "  "],
  ])("rejects %s", (_, text) => {
    expect(checkWriterOutput(text, input)).toBeNull();
  });

  it("offers triage only when slipped tasks were picked", () => {
    const plan = writerInput(brief, { ...pick, moments: ["plan"], items: { plan: [sam] } });
    expect(checkWriterOutput("Just {{item:1}}. Want to {{action:triage|give it a new day}}?", plan)).toBeNull();
  });

  it("offers to move today's tasks only when a lighter day was picked, and passes on the note", () => {
    const offer = "Just {{item:1}} today. Want to {{action:lighten|move it to tomorrow}}?";
    const plan = writerInput(brief, { ...pick, moments: ["plan"], items: { plan: [sam] } });
    expect(checkWriterOutput(offer, plan)).toBeNull();
    const tired = { ...brief, dayNote: "Not feeling well" };
    const lighter = writerInput(tired, { ...pick, moments: ["plan", "lighten"], items: { plan: [sam] } });
    expect(lighter.facts).toMatchObject({ note_for_today: "Not feeling well" });
    expect(plan.facts).not.toHaveProperty("note_for_today");
    expect(checkWriterOutput(offer, lighter)).toBe(
      "Just {{item:s1}} today. Want to {{action:lighten|move it to tomorrow}}?",
    );
    // Triage stays tied to what slipped, whatever else was picked.
    expect(checkWriterOutput("Just {{item:1}}. Want to {{action:triage|give it a new day}}?", lighter)).toBeNull();
  });

  it("keeps a reply split over lines as one paragraph", () => {
    expect(checkWriterOutput("Just {{item:2}} today.\n\nEnjoy it.", input)).toBe("Just {{item:s1}} today. Enjoy it.");
  });

  it("lets ordinary words through that happen to be a short title", () => {
    const rest = writerInput(brief, { ...pick, items: { triage: [item("r1", "Rest")], plan: [item("p1", "Plan the week")] } });
    expect(checkWriterOutput("{{item:1}} first, then the rest of the day is yours.", rest)).not.toBeNull();
    expect(checkWriterOutput("{{item:1}} first, a good moment to plan the week.", rest)).toBeNull();
    const asked = writerInput(brief, { ...pick, items: { triage: [item("c1", "Call  Sam?")], plan: [item("j1", "Pay José")] } });
    expect(checkWriterOutput("Call Sam? Then {{item:2}}.", asked)).toBeNull();
    expect(checkWriterOutput("{{item:1}}, then pay José today.", asked)).toBeNull();
  });

  it("gives the page only tokens it can read", () => {
    const out = checkWriterOutput(
      "{{item:1}} slipped. Want to {{action:triage|give it a new day}}? Then {{item:2}}, ahead of {{others|one other}}.",
      input,
    );
    const parts = parseGreeting(out ?? "");
    expect(parts.map((p) => p.kind)).toEqual(["item", "text", "action", "text", "item", "text", "others", "text"]);
    expect(parts.some((p) => "text" in p && p.text.includes("{"))).toBe(false);
  });

  it("lets the evening be late", () => {
    expect(checkWriterOutput("Since it's late, {{item:1}} can wait.", input)).toBe(
      "Since it's late, {{item:k1}} can wait.",
    );
  });

  it("allows the others phrase only when there are others", () => {
    const none = writerInput(brief, { ...pick, others: [] });
    expect(checkWriterOutput("{{item:1}} first, ahead of {{others|four others}}.", none)).toBeNull();
  });

  it("accepts a plain line when no move names an item, even with a look-back", () => {
    const quiet = writerInput(brief, {
      moments: ["clear"],
      items: {},
      others: [],
      heavyDay: null,
      considered: [],
    });
    expect(checkWriterOutput("Nothing pressing today. Enjoy it.", quiet)).toBe(
      "Nothing pressing today. Enjoy it.",
    );
  });
});

describe("writeGreeting", () => {
  const reply = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("sends the key only in its header, and returns the checked text", async () => {
    let sent: RequestInit | undefined;
    const impl = (async (_: string, init: RequestInit) => {
      sent = init;
      return new Response(
        JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "Just {{item:2}} today." }] }),
      );
    }) as unknown as typeof fetch;
    expect(await writeGreeting(brief, pick, "sk-test", impl)).toEqual({ text: "Just {{item:s1}} today." });
    expect((sent?.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
    expect(String(sent?.body)).not.toContain("sk-test");
  });

  it("gives up on an error, a rejected or cut-off reply, or a network failure", async () => {
    expect(await writeGreeting(brief, pick, "k", reply({ error: {} }, 429))).toEqual({
      failed: "Claude didn't answer (HTTP 429)",
    });
    // Why it was turned down, never what it said: that may be a title's words.
    const rejected = await writeGreeting(
      brief,
      pick,
      "k",
      reply({ stop_reason: "end_turn", content: [{ type: "text", text: "Visit https://x.y now." }] }),
    );
    expect(rejected).toEqual({
      failed: "Claude's reply was turned down: it had a link, address, number, markup or an exclamation mark",
    });
    expect(JSON.stringify(rejected)).not.toContain("x.y");
    // Cut off at max_tokens, however tidy what came back.
    expect(
      await writeGreeting(
        brief,
        pick,
        "k",
        reply({ stop_reason: "max_tokens", content: [{ type: "text", text: "Just {{item:2}} today." }] }),
      ),
    ).toEqual({ failed: "Claude's reply was cut short" });
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await writeGreeting(brief, pick, "k", boom)).toEqual({ failed: "Claude didn't answer in time" });
  });
});
