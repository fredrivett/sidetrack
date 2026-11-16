import { describe, expect, it } from "vitest";
import { mentionedHandles, mentionQueryAt, splitMentions, suggestPeople } from "./mentions";

describe("mentions", () => {
  it("finds @handles but not email addresses, code, or a sentence's last dot", () => {
    expect(
      mentionedHandles(
        "Thanks @Fred.Rivett. (@lorna) mail fred@example.com, `@code`\n```\n@block\n```\n@FRED.rivett",
      ),
    ).toEqual(["fred.rivett", "lorna"]);
  });

  it("keeps every character when it splits text into mentions", () => {
    const text = "hi @fred... and @, bye";
    const parts = splitMentions(text);
    expect(parts).toEqual(["hi ", { handle: "fred" }, "... and @, bye"]);
    expect(parts.map((p) => (typeof p === "string" ? p : `@${p.handle}`)).join("")).toBe(text);
  });

  it("reads the @query being typed just before the caret", () => {
    expect(mentionQueryAt("ping @fr", 8)).toEqual({ start: 5, query: "fr" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    // The caret sits mid-handle: only what's before it counts.
    expect(mentionQueryAt("ping @fred later", 7)).toEqual({ start: 5, query: "f" });
    expect(mentionQueryAt("ping @fred later", 16)).toBeNull();
    expect(mentionQueryAt("me@fr", 5)).toBeNull();
  });

  it("suggests people by username or any word of their name", () => {
    const people = [
      { username: "fred", name: "Fred Rivett" },
      { username: "lorna", name: "Lorna Fry" },
      { username: null, name: "Freya" },
    ];
    expect(suggestPeople(people, "Fr").map((p) => p.username)).toEqual(["fred", "lorna"]);
    expect(suggestPeople(people, "riv").map((p) => p.username)).toEqual(["fred"]);
    expect(suggestPeople(people, "").map((p) => p.username)).toEqual(["fred", "lorna"]);
  });
});
