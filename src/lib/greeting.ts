// Reading the Agenda greeting's tokens (see src/core/agendaGreeting.ts):
// `{{item:<id>}}` names an item, `{{action:<name>|<words>}}` is a phrase
// the reader taps, and `{{others|<words>}}` the rest of their undated items.
// Everything else is plain text.

export type GreetingPart =
  | { kind: "text"; text: string }
  | { kind: "item"; id: string }
  | { kind: "action"; action: string; text: string }
  | { kind: "others"; text: string };

const TOKEN = /\{\{(?:item:([^}|]+)|action:([^}|]+)\|([^}]+)|others\|([^}]+))\}\}/g;

/** The greeting's parts in order. */
export function parseGreeting(text: string): GreetingPart[] {
  const parts: GreetingPart[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > at) parts.push({ kind: "text", text: text.slice(at, m.index) });
    parts.push(
      m[1] !== undefined
        ? { kind: "item", id: m[1] }
        : m[4] !== undefined
          ? { kind: "others", text: m[4] }
          : { kind: "action", action: m[2], text: m[3] },
    );
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}
