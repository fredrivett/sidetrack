import { describe, expect, it } from "vitest";
import { joinDayNote, splitDayNote, suggestDayTags, toggleDayTag } from "./dayTags";

describe("day note tags", () => {
  it("keeps tags ahead of what was typed, in the order they're shown, and reads them back", () => {
    const note = joinDayNote(["Unwell", "Tired"], " rough night ");
    expect(note).toBe("Tired, Unwell — rough night");
    expect(splitDayNote(note)).toEqual({ tags: ["Tired", "Unwell"], rest: "rough night" });
    expect(joinDayNote(["Busy"], "")).toBe("Busy");
    expect(joinDayNote([], "just words")).toBe("just words");
  });

  it("reads a typed note as tags only when its start is all tags", () => {
    // Typed by hand, in any case: still the tag.
    expect(splitDayNote("tired")).toEqual({ tags: ["Tired"], rest: "" });
    // One word that isn't a tag makes it all writing, so nothing typed is lost.
    expect(splitDayNote("Tired, keen to finish")).toEqual({ tags: [], rest: "Tired, keen to finish" });
    // A dash later in the writing stays in it.
    expect(splitDayNote("Busy — call — then gym")).toEqual({ tags: ["Busy"], rest: "call — then gym" });
    expect(splitDayNote("")).toEqual({ tags: [], rest: "" });
  });
});

describe("toggleDayTag", () => {
  it("adds and removes a tag, keeping what was typed", () => {
    expect(toggleDayTag("Tired — rough night", "Busy")).toBe("Busy, Tired — rough night");
    expect(toggleDayTag("Busy, Tired — rough night", "Busy")).toBe("Tired — rough night");
  });

  it("won't add a tag past the note's limit, counting characters as the server does", () => {
    // "Busy — " is 7 characters, so 273 more is exactly the limit. Emoji are
    // one character each, though two UTF-16 units.
    expect(toggleDayTag("😴".repeat(273), "Busy")).toBe(`Busy — ${"😴".repeat(273)}`);
    expect(toggleDayTag("😴".repeat(274), "Busy")).toBeNull();
    // Taking one off always fits.
    expect(toggleDayTag(`Busy — ${"😴".repeat(273)}`, "Busy")).toBe("😴".repeat(273));
  });
});

describe("suggestDayTags", () => {
  const answering = (noul: Record<string, number>): typeof fetch => async () =>
    new Response(
      JSON.stringify({ answers: Object.fromEntries(Object.entries(noul).map(([k, p]) => [k, { noul: p }])) }),
    );

  it("suggests the best two tags Jev rates a fit, best first", async () => {
    const fetchImpl = answering({ Tired: 0.8, Unwell: 0.95, Stressed: 0.75, Busy: 0.69 });
    expect(await suggestDayTags("rough night, feel rotten", "key", fetchImpl)).toEqual(["Unwell", "Tired"]);
  });

  it("suggests nothing when none fits or Jev can't be asked", async () => {
    expect(await suggestDayTags("ok", "key", answering({ Busy: 0.5 }))).toEqual([]);
    const down: typeof fetch = async () => new Response("", { status: 500 });
    expect(await suggestDayTags("ok", "key", down)).toEqual([]);
  });
});
