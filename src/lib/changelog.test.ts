import { describe, expect, it } from "vitest";
import {
  checkPullRequest,
  loadEntries,
  loadPosts,
  parseEntry,
  parsePost,
  postsToShow,
  type ChangelogEntry,
} from "./changelog";

const entry = (front: string, text = "Repeats can keep to a weekday.") =>
  `---\n${front}\n---\n${text}\n`;

describe("changes/", () => {
  // Every committed entry must parse, so a bad one fails CI before /changelog.
  it("holds only valid entries, newest first", () => {
    const entries = loadEntries();
    expect(entries.length).toBeGreaterThan(0);
    const dates = entries.map((e) => e.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe("posts/", () => {
  // Every committed post must parse, with both of its drawings.
  it("holds only valid posts, newest first", () => {
    const dates = loadPosts().map((p) => p.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe("parsePost", () => {
  it("splits the body into paragraphs, joining wrapped lines", () => {
    const p = parsePost("calm.md", "---\ndate: 2026-11-21\ntitle: A calm start\n---\nOne line\nwrapped.\n\n  \nTwo.\n\nFred\n");
    expect(p.slug).toBe("calm");
    expect(p.paragraphs).toEqual(["One line wrapped.", "Two.", "Fred"]);
  });

  it("rejects a post that isn't small", () => {
    expect(() => parsePost("x.md", `---\ndate: 2026-11-21\ntitle: T\n---\n${"a".repeat(901)}\n`)).toThrow(/^x\.md: body/);
  });
});

describe("postsToShow", () => {
  const post = (slug: string, date: string) => parsePost(`${slug}.md`, `---\ndate: ${date}\ntitle: T\n---\nText.\n`);
  const posts = [post("newer", "2026-11-21"), post("older", "2026-11-10")];
  const slugs = (seen: string[], today: string) => postsToShow(posts, seen, today).map((p) => p.slug);

  // Seeing the newest must not hide the older one still unread.
  it("stacks every unseen post, newest first", () => {
    expect(slugs([], "2026-11-21")).toEqual(["newer", "older"]);
    expect(slugs(["newer"], "2026-11-21")).toEqual(["older"]);
    expect(slugs(["older", "newer"], "2026-11-21")).toEqual([]);
  });

  it("shows each for 30 days from its date, and not before it", () => {
    expect(slugs([], "2026-12-09")).toEqual(["newer", "older"]);
    expect(slugs([], "2026-12-10")).toEqual(["newer"]);
    expect(slugs([], "2026-12-21")).toEqual([]);
    expect(slugs([], "2026-11-20")).toEqual(["older"]);
  });
});

describe("parseEntry", () => {
  it("reads a full entry, with comments and a PR list", () => {
    const e = parseEntry(
      "x.md",
      entry("date: 2026-11-19\ntype: new  # new | improved | fixed\npr: [303, #304]\npost: true\nfor: self-hosters"),
    );
    expect(e).toEqual({
      file: "x.md",
      date: "2026-11-19",
      type: "new",
      pr: [303, 304],
      post: true,
      for: "self-hosters",
      text: "Repeats can keep to a weekday.",
    });
  });

  it.each([
    ["an unknown type", "date: 2026-11-19\ntype: added\npr: [1]"],
    ["a misspelt field", "date: 2026-11-19\ntype: new\nprs: [1]"],
    ["no PR", "date: 2026-11-19\ntype: new\npr: []"],
    ["a PR that isn't a number", "date: 2026-11-19\ntype: new\npr: [abc]"],
    ["an impossible day", "date: 2026-13-01\ntype: new\npr: [1]"],
    ["media outside a file name", "date: 2026-11-19\ntype: new\npr: [1]\nmedia: ../secret.png"],
  ])("rejects %s, naming the file", (_, front) => {
    expect(() => parseEntry("bad.md", entry(front))).toThrow(/^bad\.md: /);
  });

  it("rejects an entry with no text", () => {
    expect(() => parseEntry("x.md", entry("date: 2026-11-19\ntype: new\npr: [1]", ""))).toThrow(/no text/);
  });
});

describe("checkPullRequest", () => {
  const changed = (pr: number[]): ChangelogEntry[] => [
    { file: "a.md", date: "2026-11-19", type: "new", pr, text: "x" },
  ];

  it("passes an entry for this PR", () => {
    expect(checkPullRequest({ number: 7, labels: [], changed: changed([7]) })).toEqual([]);
  });

  it("passes a follow-up that adds its number to an earlier entry", () => {
    expect(checkPullRequest({ number: 8, labels: [], changed: changed([7, 8]) })).toEqual([]);
  });

  it("passes no-changelog", () => {
    expect(checkPullRequest({ number: 7, labels: ["no-changelog"], changed: [] })).toEqual([]);
  });

  it("fails a PR with no entry and no label", () => {
    expect(checkPullRequest({ number: 7, labels: [], changed: [] })).toHaveLength(1);
  });

  it("fails a PR whose changed entries don't name it", () => {
    const errors = checkPullRequest({ number: 9, labels: [], changed: changed([7]) });
    expect(errors).toEqual([expect.stringContaining("with 9 in its pr list")]);
  });

  // Editing an entry changes what users read, so it can't hide behind the label.
  it("fails no-changelog on a PR that edits an entry", () => {
    expect(checkPullRequest({ number: 7, labels: ["no-changelog"], changed: changed([3]) })).toHaveLength(1);
  });
});
