import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// The changelog is one Markdown file per user-facing change in changes/ at the
// repo root (AGENTS.md, "Changelog"). The /changelog page and the PR check
// (scripts/check-changelog.ts) both read entries through this module, so
// they can't disagree about what a valid entry is.

export const CHANGES_DIR = join(process.cwd(), "changes");

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
  const [fields, text] = frontMatter(file, source);
  return { ...check(file, entrySchema, { ...fields, text }), file };
}

/** A file's front matter fields and the text after them. */
function frontMatter(file: string, source: string): [Record<string, unknown>, string] {
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
  return [fields, match[2].trim()];
}

function check<T>(file: string, schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`);
    throw new Error(`${file}: ${problems.join("; ")}`);
  }
  return result.data;
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

// Small posts: a few short paragraphs about one notable change, in Fred's
// words, with a drawing in the Get started style. The Brief stacks the ones
// the viewer hasn't seen; /changelog shows them all on its timeline.

export const POSTS_DIR = join(process.cwd(), "posts");

/** How long a post stays on the Brief after its date, unless dismissed. */
export const POST_SHOWS_FOR_DAYS = 30;

const postSchema = z
  .object({
    date: entrySchema.shape.date,
    title: z.string().min(1).max(80, "keep the title short"),
    image: z.string().regex(/^[a-z0-9-]+$/, "image is the drawing's name in public/posts/").optional(),
    body: z.string().min(1, "the post has no text").max(900, "keep the post short"),
  })
  .strict();

export type ChangelogPost = z.infer<typeof postSchema> & {
  /** The file's name without .md, which also names it when dismissed. */
  slug: string;
  /** The body's paragraphs, split at blank lines. */
  paragraphs: string[];
};

/** Parses one post file. Throws with the file name and what's wrong. */
export function parsePost(file: string, source: string): ChangelogPost {
  const [fields, body] = frontMatter(file, source);
  const post = check(file, postSchema, { ...fields, body });
  return {
    ...post,
    slug: file.replace(/\.md$/, ""),
    paragraphs: post.body.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()),
  };
}

/** Every post, newest first. */
export function loadPosts(dir = POSTS_DIR): ChangelogPost[] {
  if (!existsSync(dir)) return [];
  const posts = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => parsePost(f, readFileSync(join(dir, f), "utf8")));
  for (const p of posts) {
    for (const theme of ["light", "dark"]) {
      if (p.image && !existsSync(join(process.cwd(), "public", "posts", `${p.image}-${theme}.webp`))) {
        throw new Error(`${p.slug}.md: public/posts/${p.image}-${theme}.webp is missing`);
      }
    }
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));
}

/**
 * The posts the Brief stacks, newest first: those under POST_SHOWS_FOR_DAYS
 * old on `today` (YYYY-MM-DD) that the viewer hasn't read or dismissed.
 */
export function postsToShow(posts: ChangelogPost[], seen: string[], today: string): ChangelogPost[] {
  const now = Date.parse(`${today}T00:00:00Z`);
  return posts.filter((p) => {
    const age = (now - Date.parse(`${p.date}T00:00:00Z`)) / 86_400_000;
    return age >= 0 && age < POST_SHOWS_FOR_DAYS && !seen.includes(p.slug);
  });
}

/**
 * What stops a PR merging, or [] when it may. A PR either carries
 * `no-changelog` and touches no entry, or adds or updates an entry that lists
 * its number. Fred approves an entry's wording in the agent's thread before
 * the PR opens (AGENTS.md, "Changelog"); CI doesn't check that.
 */
export function checkPullRequest(pr: {
  number: number;
  labels: string[];
  /** Entries in files the PR added or changed. */
  changed: ChangelogEntry[];
}): string[] {
  if (pr.labels.includes("no-changelog")) {
    return pr.changed.length
      ? [`no-changelog is set, but the PR changes ${pr.changed.map((e) => e.file).join(", ")}`]
      : [];
  }
  return pr.changed.some((e) => e.pr.includes(pr.number))
    ? []
    : [
        `Add an entry in changes/ with ${pr.number} in its pr list (or add it to the entry this PR finishes), or label the PR no-changelog if users won't notice it.`,
      ];
}
