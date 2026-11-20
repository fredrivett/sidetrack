// The changelog check on every PR (.github/workflows/changelog.yml). The rules
// live in checkPullRequest (src/lib/changelog.ts); this gathers what it needs
// from git and GitHub. Needs PR_NUMBER, BASE_SHA, LABELS (JSON array of
// names), GITHUB_REPOSITORY and GH_TOKEN.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANGES_DIR, checkPullRequest, loadEntries, parseEntry } from "../src/lib/changelog";

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

const number = Number(process.env.PR_NUMBER);
const labels = (JSON.parse(process.env.LABELS ?? "[]") as string[]).map(String);

// Every entry must parse, not only this PR's, so main never holds a bad one.
loadEntries();

const changed = run("git", [
  "diff", "--name-only", "--diff-filter=AMR", `${process.env.BASE_SHA}...HEAD`, "--", "changes/",
])
  .split("\n")
  .filter((f) => f.endsWith(".md") && !f.endsWith("README.md"))
  .map((f) => {
    const name = f.slice("changes/".length);
    return parseEntry(name, readFileSync(join(CHANGES_DIR, name), "utf8"));
  });

// The label's latest "labeled" event says who added it; label names alone
// can't, and anyone with write access can add one.
let approvedBy: string | null = null;
if (labels.includes("changelog-approved")) {
  const actors = run("gh", [
    "api", "--paginate", `repos/${process.env.GITHUB_REPOSITORY}/issues/${number}/events`,
    "--jq", '.[] | select(.event == "labeled" and .label.name == "changelog-approved") | .actor.login',
  ]).split("\n").filter(Boolean);
  approvedBy = actors.at(-1) ?? null;
}

const errors = checkPullRequest({ number, labels, approvedBy, changed });
for (const e of changed) console.log(`Entry ${e.file}: ${e.text}`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log("✓ Changelog check passed");
