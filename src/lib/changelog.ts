import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// The changelog is one Markdown file per user-facing change in changes/ at the
// repo root (AGENTS.md, "Changelog"). The /changelog page and the PR check
// (scripts/check-changelog.ts) both read entries through this module, so
// they can't disagree about what a valid entry is.

export const CHANGES_DIR = join(process.cwd(), "changes");

/** Who may approve an entry's wording, by adding `changelog-approved`. */
export const CHANGELOG_APPROVER = "fredrivett";

const entrySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "date isn't a real day"),
    type: z.enum(["new", "improved", "fixed"]),
    pr: z.array(z.number().int().positive()).min(1, "pr needs at least one PR number"),
    post: z.boolean().optional(),
    for: z.literal("self-hosters").optional(),
    media: z
      .string()
      .regex(/^[\w.-]+\.(png|jpe?g|gif|webp|mp4)$/, "media must be a file name in public/changelog/")
      .optional(),
    text: z.string().min(1, "the entry has no text").max(300, "keep the entry to one sentence"),
  })
  .strict();

export type ChangelogEntry = z.infer<typeof entrySchema> & { file: string };

/** Parses one entry file. Throws with the file name and what's wrong. */
export function parseEntry(file: string, source: string): ChangelogEntry {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source.replace(/\r\n/g, "\n"));
  if (!match) throw new Error(`${file}: needs front matter between --- lines, then the text`);
  const fields: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const bare = line.replace(/\s+#\s.*$/, "").trim();
    if (!bare) continue;
    const kv = /^([a-z]+):\s*(.*)$/.exec(bare);
    if (!kv) throw new Error(`${file}: can't read front matter line "${line}"`);
    fields[kv[1]] = value(kv[1], kv[2]);
  }
  const result = entrySchema.safeParse({ ...fields, text: match[2].trim() });
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".") || "entry"}: ${i.message}`);
    throw new Error(`${file}: ${problems.join("; ")}`);
  }
  return { ...result.data, file };
}

function value(key: string, raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (key === "pr") {
    const list = raw.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^#/, ""));
    return list.filter(Boolean).map((n) => (/^\d+$/.test(n) ? Number(n) : n));
  }
  return raw;
}

/** Every entry, newest first (by date, then by its newest PR). */
export function loadEntries(dir = CHANGES_DIR): ChangelogEntry[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md");
  const entries = files.map((f) => parseEntry(f, readFileSync(join(dir, f), "utf8")));
  for (const e of entries) {
    if (e.media && !existsSync(join(process.cwd(), "public", "changelog", e.media))) {
      throw new Error(`${e.file}: media ${e.media} isn't in public/changelog/`);
    }
  }
  return entries
    .sort((a, b) => b.date.localeCompare(a.date) || Math.max(...b.pr) - Math.max(...a.pr));
}

/**
 * What stops a PR merging, or [] when it may. A PR either carries
 * `no-changelog` and touches no entry, or adds or updates an entry that lists
 * its number and has the approver's `changelog-approved` label.
 */
export function checkPullRequest(pr: {
  number: number;
  labels: string[];
  /** Who last added `changelog-approved`, if anyone. */
  approvedBy: string | null;
  /** Entries in files the PR added or changed. */
  changed: ChangelogEntry[];
}): string[] {
  if (pr.labels.includes("no-changelog")) {
    return pr.changed.length
      ? [`no-changelog is set, but the PR changes ${pr.changed.map((e) => e.file).join(", ")}`]
      : [];
  }
  const errors: string[] = [];
  if (!pr.changed.some((e) => e.pr.includes(pr.number))) {
    errors.push(
      `Add an entry in changes/ with ${pr.number} in its pr list (or add it to the entry this PR finishes), or label the PR no-changelog if users won't notice it.`,
    );
  }
  if (!pr.labels.includes("changelog-approved")) {
    errors.push(`Entries need ${CHANGELOG_APPROVER} to approve their wording with the changelog-approved label.`);
  } else if (pr.approvedBy !== CHANGELOG_APPROVER) {
    errors.push(`changelog-approved was added by ${pr.approvedBy ?? "someone else"}, not ${CHANGELOG_APPROVER}.`);
  }
  return errors;
}
