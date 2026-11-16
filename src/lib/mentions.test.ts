import { describe, expect, it } from "vitest";
import { mentionedPeople, mentionQueryAt, splitMentions, suggestPeople } from "./mentions";

const fred = { username: "fred.rivett", name: "Fred Rivett" };
const lorna = { username: "lorna", name: "Lorna Fry" };
const al = { username: "al.", name: "Al Dot" };
const names = (people: { username: string | null }[]) => people.map((p) => p.username);

describe("mentions", () => {
  it("finds the people mentioned in the text, not in emails, code or links", () => {
    const body = [
      "Thanks @Fred.Rivett. (@lorna) and @nobody, again @FRED.rivett",
      "mail me@lorna.dev, `@al.` [ask @al.](https://x.dev) [@al.][ref]",
      "~~~\n@al.\n~~~",
      "    @al. in indented code",
      "",
      "[ref]: https://x.dev",
    ].join("\n");
    expect(names(mentionedPeople(body, [lorna, fred, al]))).toEqual(["fred.rivett", "lorna"]);
  });

  it("lets a username end in a dot, and a sentence end after one", () => {
    expect(names(mentionedPeople("over to @al.", [al]))).toEqual(["al."]);
    expect(names(mentionedPeople("over to @lorna..", [lorna]))).toEqual(["lorna"]);
  });

  it("keeps every character when it splits text into mentions", () => {
    const find = (h: string) => (h === "fred" ? h : undefined);
    const text = "hi @fred... and @bob, @";
    const parts = splitMentions(text, find);
    expect(parts).toEqual(["hi ", { person: "fred", text: "@fred" }, "... and @bob, @"]);
    expect(parts.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe(text);
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
    expect(names(suggestPeople(people, "Fr"))).toEqual(["fred", "lorna"]);
    expect(names(suggestPeople(people, "riv"))).toEqual(["fred"]);
    expect(names(suggestPeople(people, ""))).toEqual(["fred", "lorna"]);
  });
});
