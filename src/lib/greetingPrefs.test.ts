import { describe, expect, it } from "vitest";
import { NOTE_MAX, parseGreetingPrefs } from "./greetingPrefs";

describe("parseGreetingPrefs", () => {
  // Read leniently, so the greeting can change shape without a migration.
  it("keeps what it knows and defaults the rest", () => {
    expect(parseGreetingPrefs(null)).toEqual({ length: "long", note: "", shareNote: true });
    expect(
      parseGreetingPrefs({ length: "medium", note: " Be  brief ", shareNote: false, moments: { tidy: false } }),
    ).toEqual({ length: "medium", note: "Be brief", shareNote: false });
    expect(parseGreetingPrefs({ length: "huge", note: 4, shareNote: "no" })).toEqual({
      length: "long",
      note: "",
      shareNote: true,
    });
  });

  it("caps a note by characters, not UTF-16 units, so an emoji isn't split", () => {
    const note = parseGreetingPrefs({ note: "🌱".repeat(NOTE_MAX + 5) }).note;
    expect(Array.from(note)).toHaveLength(NOTE_MAX);
    expect(note.endsWith("🌱")).toBe(true);
  });
});
