// Fred approves every changelog entry before it leaves the machine
// (AGENTS.md, "Changelog"). The Amp plugin (.amp/plugins/changelog-approval.ts)
// and the Claude Code hook (.claude/settings.json) stop `git push` and
// `gh pr create` while an entry on the branch is unapproved, and ask him.
//
//   tsx scripts/changelog-approval.ts pending        JSON list of unapproved entries
//   tsx scripts/changelog-approval.ts approve HASH…  record entries as approved
//   tsx scripts/changelog-approval.ts claude-pre     PreToolUse hook (stdin: hook JSON)
//   tsx scripts/changelog-approval.ts claude-post    PostToolUse hook: the push ran, so
//                                                    Fred allowed it; record approval
//
// Approvals are content hashes kept inside .git, never committed: rewording an
// entry after approval asks again.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { parseEntry, parsePost } from "../src/lib/changelog";

const GATED = /\b(git\s+push|gh\s+pr\s+create)\b/;

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const store = () => git("rev-parse", "--git-path", "changelog-approvals");
const approved = () => {
  const path = store();
  return new Set(existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : []);
};

/** An entry or post awaiting approval, in the shape the plugin's dialog shows. */
type Pending = { file: string; type: string; pr: number[]; text: string; hash: string };

/** Entries and posts the branch's commits add or change, not yet approved. */
function pending(): Pending[] {
  let base: string;
  try {
    base = git("merge-base", "origin/main", "HEAD");
  } catch {
    return [];
  }
  const done = approved();
  return git("diff", "--name-only", "--diff-filter=AMR", `${base}...HEAD`, "--", "changes/", "posts/")
    .split("\n")
    .filter((f) => f.endsWith(".md") && !f.endsWith("README.md"))
    .map((f): Pending => {
      const source = git("show", `HEAD:${f}`);
      const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
      if (f.startsWith("posts/")) {
        const post = parsePost(f.slice("posts/".length), source);
        return { file: f, type: "post", pr: [], text: `${post.title}\n\n${post.body}`, hash };
      }
      const { file, type, pr, text } = parseEntry(f.slice("changes/".length), source);
      return { file: `changes/${file}`, type, pr, text, hash };
    })
    .filter((e) => !done.has(e.hash));
}

const approve = (hashes: string[]) => {
  if (hashes.length) appendFileSync(store(), hashes.map((h) => `${h}\n`).join(""));
};

const describe = (e: Pending) =>
  `${e.file} (${e.type}, ${e.pr.map((n) => `#${n}`).join(" ")}): ${e.text}`;

const mode = process.argv[2];
if (mode === "pending") {
  process.stdout.write(JSON.stringify(pending()));
} else if (mode === "approve") {
  approve(process.argv.slice(3));
} else if (mode === "claude-pre" || mode === "claude-post") {
  const input = JSON.parse(readFileSync(0, "utf8")) as { tool_input?: { command?: string } };
  if (GATED.test(input.tool_input?.command ?? "")) {
    const entries = pending();
    if (entries.length && mode === "claude-pre") {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: `Approve this changelog text before they're pushed:\n${entries.map(describe).join("\n")}`,
          },
        }),
      );
    }
    if (mode === "claude-post") approve(entries.map((e) => e.hash));
  }
} else {
  console.error("usage: changelog-approval.ts pending | approve HASH… | claude-pre | claude-post");
  process.exit(1);
}
