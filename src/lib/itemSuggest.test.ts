import { describe, expect, it } from "vitest";
import { askAboutDraft } from "./itemSuggest";

const DRAFT = { title: "Buy JR rail pass", description: "" };
const LISTS = [
  { id: "groc", name: "Groceries", summary: "", itemTitles: ["Milk"] },
  { id: "japan", name: "Japan trip", summary: "", itemTitles: ["Book flights"] },
];
const ITEMS = [
  { id: "j1", title: "Book flights", topLevel: true },
  { id: "j2", title: "Get JR pass", topLevel: true },
  { id: "j3", title: "Day 1: Tokyo", topLevel: false },
];

function respond(answers: Record<string, Record<string, number>>): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        answers: Object.fromEntries(
          Object.entries(answers).map(([q, probabilities]) => [
            q,
            { type: "choice", probabilities },
          ]),
        ),
      }),
    );
}

describe("askAboutDraft", () => {
  it("picks a list only when it's at least as likely as all else together", async () => {
    const pick = async (probabilities: Record<string, number>) =>
      (await askAboutDraft(DRAFT, { lists: LISTS }, "key", respond({ list: probabilities }))).listId;
    expect(await pick({ japan: 0.56, groc: 0.04, none: 0.4 })).toBe("japan");
    expect(await pick({ japan: 0.45, groc: 0.15, none: 0.4 })).toBeNull();
    expect(await pick({ none: 0.8, japan: 0.2 })).toBeNull();
    // An answer outside the options is never trusted.
    expect(await pick({ constructor: 0.9, none: 0.1 })).toBeNull();
    // Nor is a probability that isn't a number.
    expect(await pick({ japan: "0.9" as unknown as number, none: 0.1 })).toBeNull();
  });

  it("warns of a confident duplicate and drops it as a parent", async () => {
    const result = await askAboutDraft(
      DRAFT,
      { items: ITEMS },
      "key",
      respond({
        duplicate: { j2: 0.98, none: 0.02 },
        parent: { j2: 0.84, none: 0.16 },
      }),
    );
    expect(result).toMatchObject({ duplicateId: "j2", parentId: null });
  });

  it("suggests a confident parent among top-level items", async () => {
    let sent: { questions: { parent: { criteria: object } } } | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return respond({
        duplicate: { none: 0.9, j1: 0.1 },
        parent: { j1: 0.72, none: 0.28 },
      })("");
    };
    const result = await askAboutDraft(DRAFT, { items: ITEMS }, "key", fetchImpl);
    expect(result).toMatchObject({ duplicateId: null, parentId: "j1" });
    // A sub-item can't have sub-items, so it's never offered as a parent.
    expect(Object.keys(sent?.questions.parent.criteria ?? {})).toEqual([
      "j1",
      "j2",
      "none",
    ]);
  });

  it("suggests nothing when the request fails", async () => {
    const offline: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await askAboutDraft(DRAFT, { items: ITEMS, timing: true }, "key", offline)).toEqual({
      listId: null,
      duplicateId: null,
      parentId: null,
      due: null,
      repeat: null,
      labelId: null,
      assigneeId: null,
    });
  });

  it("fills in only what Jev is confident of, as the app's own values", async () => {
    let sent: { questions: Record<string, unknown> } | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return respond({
        due: { friday: 0.9, none: 0.1 },
        repeat: { "weekly-fri": 0.8, weekly: 0.1, none: 0.1 },
        label: { "label-travel": 0.6, none: 0.4 },
      })("");
    };
    const result = await askAboutDraft(
      { title: "Bins out every Friday", description: "" },
      {
        timing: true,
        labels: [{ id: "label-travel", name: "Travel" }],
        people: [{ id: "me", name: "Fred" }],
      },
      "key",
      fetchImpl,
    );
    expect(result).toMatchObject({
      due: "friday",
      repeat: { every: 1, unit: "week", on: "fri" },
      // Likelier than not, but not enough to fill in.
      labelId: null,
      assigneeId: null,
    });
    // There's no one to choose between, so no one is asked about.
    expect(Object.keys(sent?.questions ?? {})).toEqual(["due", "repeat", "label"]);
  });
});
