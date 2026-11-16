// @mentions in comments: `@username`, as Linear and Slack write them. The
// body stores the plain text; who it names is worked out when it's read, so
// a renamed user's old mentions simply stop matching. Shared by the server
// (who to notify) and the browser (highlighting, the composer's suggestions).

// A handle starts after the start of the text, whitespace or punctuation that
// can sit before a name, so `fred@example.com` isn't a mention. Same charset
// as usernames (lib/username.ts).
const MENTION_RE = /(^|[\s([{"'“‘])@([a-zA-Z0-9_.]+)/g;

/** Splits text into plain runs and mentions, keeping every character. A
 * mention's trailing dots end the sentence, not the handle (`thanks @fred.`). */
export function splitMentions(text: string): (string | { handle: string })[] {
  const out: (string | { handle: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const handle = m[2].replace(/\.+$/, "");
    if (!handle) continue;
    const at = m.index + m[1].length;
    if (at > last) out.push(text.slice(last, at));
    out.push({ handle });
    last = at + 1 + handle.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The handles a comment body mentions, lowercased and once each. Code spans
 * and blocks don't count, as they don't render as mentions. */
export function mentionedHandles(body: string): string[] {
  const prose = body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const handles = splitMentions(prose).flatMap((part) =>
    typeof part === "string" ? [] : [part.handle.toLowerCase()],
  );
  return [...new Set(handles)];
}

interface Mentionable {
  username: string | null;
  name: string | null;
}

/** The people to suggest for a typed `@query`, in the order given: anyone
 * whose username or a word of whose name starts with it. */
export function suggestPeople<P extends Mentionable>(people: P[], query: string, max = 6): P[] {
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
