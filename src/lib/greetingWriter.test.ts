import { describe, expect, it } from "vitest";
import type { AgendaBrief, BriefItem } from "../core/agendaBrief";
import type { GreetingPick } from "./greetingJev";
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
  spans: [],
  undated: [],
  stale: [],
};
const pick: GreetingPick = {
  moments: ["triage", "plan"],
  items: { triage: [bank], plan: [sam] },
  others: [item("o1", "Sort the loft")],
  heavyDay: null,
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
    });
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
    ["a malformed token", "Start with {{item:1} today."],
    ["a stray brace", "Start with {{item:1}} {today}."],
    ["a link", "Start with {{item:1}}, then see evil.example at https://evil.example."],
    ["a bare domain", "Start with {{item:1}} at www.evil.example."],
    ["markup", "Start with **{{item:1}}**."],
    ["an exclamation", "Start with {{item:1}}!"],
    ["a scolding word", "{{item:1}} is overdue."],
    ["calling a task late", "{{item:1}} is running late."],
    ["a title spelled out", "Call the bank, then {{item:2}}."],
    ["more than three sentences", "{{item:1}} first. Then this. Then that. And more."],
    ["a second line", "{{item:1}} first.\nThen this."],
    ["no item when it was given some", "A gentle Wednesday."],
    ["nothing", "  "],
  ])("rejects %s", (_, text) => {
    expect(checkWriterOutput(text, input)).toBeNull();
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

  it("accepts a plain line when there's no item to name", () => {
    const quiet = writerInput({ ...brief, lookBack: { ...brief.lookBack, finishedCount: 0 } }, {
      moments: ["clear"],
      items: {},
      others: [],
      heavyDay: null,
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
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Just {{item:2}} today." }] }));
    }) as unknown as typeof fetch;
    expect(await writeGreeting(brief, pick, "sk-test", impl)).toBe("Just {{item:s1}} today.");
    expect((sent?.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
    expect(String(sent?.body)).not.toContain("sk-test");
  });

  it("gives up on an error, a rejected reply or a network failure", async () => {
    expect(await writeGreeting(brief, pick, "k", reply({ error: {} }, 429))).toBeNull();
    expect(
      await writeGreeting(brief, pick, "k", reply({ content: [{ type: "text", text: "Visit https://x.y now." }] })),
    ).toBeNull();
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await writeGreeting(brief, pick, "k", boom)).toBeNull();
  });
});
