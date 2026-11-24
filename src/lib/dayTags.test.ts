import { describe, expect, it } from "vitest";
import { cleanDayTag, joinDayNote, splitDayNote, suggestDayTags, toggleDayTag } from "./dayTags";

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

  it("reads the writer's own tags after the presets, and only theirs", () => {
    const note = joinDayNote(["Wound up", "Tired"], "report", ["Wound up"]);
    expect(note).toBe("Tired, Wound up — report");
    expect(splitDayNote(note, ["Wound up"])).toEqual({ tags: ["Tired", "Wound up"], rest: "report" });
    // Someone without it reads it as writing, all of it.
    expect(splitDayNote(note)).toEqual({ tags: [], rest: note });
    expect(toggleDayTag("Tired — report", "Calm", ["Calm"])).toBe("Tired, Calm — report");
  });
});

describe("cleanDayTag", () => {
  it("takes a word or three of letters, capitalised, and nothing that breaks a note", () => {
    expect(cleanDayTag("  wound   up ")).toBe("Wound up");
    expect(cleanDayTag("Can't focus")).toBe("Can't focus");
    expect(cleanDayTag("Été")).toBe("Été");
    expect(cleanDayTag("Tired, busy")).toBeNull();
    expect(cleanDayTag("Busy — call")).toBeNull();
    expect(cleanDayTag("Day 2")).toBeNull();
    expect(cleanDayTag("One two three four")).toBeNull();
    expect(cleanDayTag("Twentyonecharacterss")).toBe("Twentyonecharacterss");
    expect(cleanDayTag("Twentyonecharactersss")).toBeNull();
    expect(cleanDayTag("")).toBeNull();
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
  const claude = (tags: unknown, stop = "end_turn"): typeof fetch => async () =>
    new Response(JSON.stringify({ stop_reason: stop, content: [{ type: "text", text: JSON.stringify({ tags }) }] }));
  const none = { own: [], removed: [] };

  it("suggests up to three, existing ones as spelled there and new ones tidied", async () => {
    const fetchImpl = claude(["unwell", "Calm", "tired", "Wound up", "Busy"]);
    expect(await suggestDayTags("off sick", { own: ["Calm"], removed: [] }, "key", fetchImpl)).toEqual([
      "Unwell",
      "Calm",
      "Tired",
    ]);
    expect(await suggestDayTags("can't sit still", none, "key", claude(["restless", "Restless"]))).toEqual(["Restless"]);
  });

  it("drops what can't be a tag, what they took off, and new ones once they have eight", async () => {
    const said = claude(["Hospital, ward 4", "Wound up", "Calm", "Tired"]);
    expect(await suggestDayTags("x", { own: [], removed: ["wound up"] }, "key", said)).toEqual(["Calm", "Tired"]);
    const eight = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
    expect(await suggestDayTags("x", { own: eight, removed: [] }, "key", claude(["Calm", "Golf", "Tired"]))).toEqual([
      "Golf",
      "Tired",
    ]);
  });

  it("suggests nothing when Claude can't be asked or doesn't finish", async () => {
    const down: typeof fetch = async () => new Response("", { status: 500 });
    expect(await suggestDayTags("ok", none, "key", down)).toEqual([]);
    expect(await suggestDayTags("ok", none, "key", claude(["Tired"], "max_tokens"))).toEqual([]);
    expect(await suggestDayTags("ok", none, "key", claude("Tired"))).toEqual([]);
  });
});
