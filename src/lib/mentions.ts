import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

// @mentions in comments: `@username`, as Linear and Slack write them. The
// body stores the plain text; who it names is worked out when it's read, so
// a renamed user's old mentions simply stop matching. Shared by the server
// (who to notify) and the browser (highlighting, the composer's suggestions),
// which find them the same way: in the Markdown's text, not its code or links.

// A handle starts after the start of the text, whitespace or punctuation that
// can sit before a name, so `fred@example.com` isn't a mention. Same charset
// as usernames (lib/username.ts).
const MENTION_RE = /(^|[\s([{"'“‘])@([a-zA-Z0-9_.]+)/g;

/**
 * Splits text into plain runs and the people it mentions, keeping every
 * character. `find` resolves a handle to a person, or undefined. A username
 * may end in a dot, so the whole handle is tried first; failing that, its
 * trailing dots end the sentence instead (`thanks @fred.`).
 */
export function splitMentions<P>(
  text: string,
  find: (handle: string) => P | undefined,
): (string | { person: P; text: string })[] {
  const out: (string | { person: P; text: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    let handle = m[2];
    let person = find(handle);
    while (!person && handle.endsWith(".")) {
      handle = handle.slice(0, -1);
      if (handle) person = find(handle);
    }
    if (!person) continue;
    const at = m.index + m[1].length;
    if (at > last) out.push(text.slice(last, at));
    out.push({ person, text: `@${handle}` });
    last = at + 1 + handle.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The bits of a Markdown (mdast) tree mentions touch. */
export interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: object;
}

/**
 * Replaces each mention in the tree's text with `toNode(person, text)`.
 * Code is never text, and link labels are left as written.
 */
export function replaceMentions<P>(
  node: MdNode,
  find: (handle: string) => P | undefined,
  toNode: (person: P, text: string) => MdNode,
): void {
  if (!node.children || node.type === "link" || node.type === "linkReference") return;
  node.children = node.children.flatMap((child) => {
    if (child.type !== "text") {
      replaceMentions(child, find, toNode);
      return [child];
    }
    return splitMentions(child.value ?? "", find).map((part) =>
      typeof part === "string" ? { type: "text", value: part } : toNode(part.person, part.text),
    );
  });
}

/** The people a comment body mentions, once each, matched case-insensitively
 * by username: what the comment shows as mentions. */
export function mentionedPeople<P extends { username: string | null }>(
  body: string,
  people: P[],
): P[] {
  const byHandle = new Map(people.flatMap((p) => (p.username ? [[p.username, p]] : [])));
  const found = new Set<P>();
  const tree = fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as MdNode;
  replaceMentions(
    tree,
    (handle) => byHandle.get(handle.toLowerCase()),
    (person, text) => {
      found.add(person);
      return { type: "text", value: text };
    },
  );
  return [...found];
}

/** The people to suggest for a typed `@query`, in the order given: anyone
 * whose username or a word of whose name starts with it. */
export function suggestPeople<P extends { username: string | null; name: string | null }>(
  people: P[],
  query: string,
  max = 6,
): P[] {
  const q = query.toLowerCase();
  return people
    .filter(
      (p) =>
        p.username &&
        (p.username.startsWith(q) ||
          (p.name ?? "").toLowerCase().split(/\s+/).some((word) => word.startsWith(q))),
    )
    .slice(0, max);
}

/** The `@…` being typed just before the caret, for the composer to suggest
 * people for: where its `@` is and what follows it so far. */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const m = /(^|[\s([{"'“‘])@([a-zA-Z0-9_.]*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: m.index + m[1].length, query: m[2] };
}
