import { describe, expect, it } from "vitest";
import { checkPullRequest, loadEntries, parseEntry, type ChangelogEntry } from "./changelog";

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

  it("passes an entry for this PR approved by Fred", () => {
    expect(
      checkPullRequest({ number: 7, labels: ["changelog-approved"], approvedBy: "fredrivett", changed: changed([7]) }),
    ).toEqual([]);
  });

  it("passes a follow-up that adds its number to an earlier entry", () => {
    expect(
      checkPullRequest({ number: 8, labels: ["changelog-approved"], approvedBy: "fredrivett", changed: changed([7, 8]) }),
    ).toEqual([]);
  });

  it("passes no-changelog without asking for approval", () => {
    expect(checkPullRequest({ number: 7, labels: ["no-changelog"], approvedBy: null, changed: [] })).toEqual([]);
  });

  it("fails an entry approved by anyone but Fred", () => {
    const errors = checkPullRequest({ number: 7, labels: ["changelog-approved"], approvedBy: "agent-bot", changed: changed([7]) });
    expect(errors).toEqual([expect.stringContaining("added by agent-bot")]);
  });

  it("fails an unapproved entry", () => {
    expect(checkPullRequest({ number: 7, labels: [], approvedBy: null, changed: changed([7]) })).toHaveLength(1);
  });

  it("fails an approved PR whose changed entries don't name it", () => {
    const errors = checkPullRequest({ number: 9, labels: ["changelog-approved"], approvedBy: "fredrivett", changed: changed([7]) });
    expect(errors).toEqual([expect.stringContaining("with 9 in its pr list")]);
  });

  // Editing an entry changes what users read, so it needs approval too.
  it("fails no-changelog on a PR that edits an entry", () => {
    expect(checkPullRequest({ number: 7, labels: ["no-changelog"], approvedBy: null, changed: changed([3]) })).toHaveLength(1);
  });
});
