// Pure, framework-agnostic helpers for the project icon. A project's icon is a
// single nullable value that is either an emoji grapheme ("🚀") or an absolute
// http(s) image URL. When unset, the icon falls back to the homepage's favicon
// (if a homepageUrl is set), then to a generic glyph rendered by the UI. No DB
// or framework access here — string/URL math only.

import { normalizeWebUrl } from "./url";

// Match exactly ONE emoji, anchored end-to-end so mixed text ("a🚀") or plain
// short text can't slip through as an icon: a flag (two regional indicators), a
// keycap ([0-9#*] + enclosing keycap, e.g. 1️⃣), or a pictographic base with
// optional skin-tone modifier and variation selector, plus any ZWJ-joined
// continuations (👩‍💻, 👨‍👩‍👧). Anchoring makes this a whole-string test, not a
// substring search.
const EMOJI_RE =
  /^(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}\p{Emoji_Modifier}?\uFE0F?(?:\u200D\p{Extended_Pictographic}\p{Emoji_Modifier}?\uFE0F?)*)$/u;

export function isEmoji(value: string): boolean {
  return EMOJI_RE.test(value.trim());
}

/**
 * Validate/normalize a user-chosen icon for storage. Blank → null (cleared).
 * An emoji is stored verbatim; anything else is treated as an image URL and run
 * through the web-URL normalizer (bare host gains https://, non-http/dot-less
 * hosts rejected). Throws on a value that is neither a plausible emoji nor URL.
 */
export function normalizeProjectIcon(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isEmoji(trimmed)) return trimmed;
  return normalizeWebUrl(trimmed, "project icon");
}

/**
 * Ordered favicon candidates for a homepage URL, best-first, to be tried in
 * turn (the UI advances on image load error). The site's own icons come first —
 * the conventional /favicon.svg (crisp, scales to any size) then /favicon.ico —
 * needing no third party, with Google's favicon service as a backup for sites
 * that only declare an icon at a non-conventional path. Returns [] when the URL
 * has no parseable host. Loaded as plain <img>, so no CORS concern and nothing
 * to store server-side.
 */
export function faviconCandidates(homepageUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(homepageUrl);
  } catch {
    return [];
  }
  if (!url.hostname) return [];
  return [
    `${url.origin}/favicon.svg`,
    `${url.origin}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
      url.hostname,
    )}&sz=64`,
  ];
}

export type ResolvedIcon =
  | { kind: "emoji"; emoji: string }
  // `srcs` is an ordered candidate list; the renderer falls to the next on a
  // load error, then to the letter glyph once exhausted.
  | { kind: "image"; srcs: string[] }
  | { kind: "none" };

/**
 * Resolve what to actually render for a project, applying the fallback chain:
 * explicit icon (emoji or image) → homepage favicon → nothing (the UI shows a
 * generic glyph). Pure so it can drive both the trigger and the picker state.
 */
export function resolveProjectIcon(
  icon: string | null,
  homepageUrl: string | null,
): ResolvedIcon {
  if (icon) {
    return /^https?:\/\//i.test(icon)
      ? { kind: "image", srcs: [icon] }
      : { kind: "emoji", emoji: icon };
  }
  if (homepageUrl) {
    const srcs = faviconCandidates(homepageUrl);
    if (srcs.length > 0) return { kind: "image", srcs };
  }
  return { kind: "none" };
}
