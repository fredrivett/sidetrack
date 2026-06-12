// Pure, framework-agnostic helpers for the project icon. A project's icon is a
// single nullable value that is either an emoji grapheme ("🚀") or an absolute
// http(s) image URL. When unset, the icon falls back to the homepage's favicon
// (if a homepageUrl is set), then to a generic glyph rendered by the UI. No DB
// or framework access here — string/URL math only.

import { normalizeWebUrl } from "./url";

// An Extended_Pictographic or Regional_Indicator code point marks a value as an
// emoji; together these cover plain emoji, skin-tone/ZWJ sequences, and flags
// (which are pairs of regional indicators, not pictographic) without
// enumerating them. The length cap keeps a pasted sentence from being mistaken
// for an emoji (the longest realistic sequences stay well under 16 UTF-16 units).
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function isEmoji(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 16 &&
    !/^https?:\/\//i.test(trimmed) &&
    EMOJI_RE.test(trimmed)
  );
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
 * Google's public favicon service for a homepage URL, sized for a crisp small
 * glyph. Returns null when the URL has no parseable host. It's loaded as a
 * plain <img>, so there's no CORS concern and nothing to store server-side.
 */
export function faviconUrl(homepageUrl: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(homepageUrl).hostname;
  } catch {
    return null;
  }
  if (!hostname) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
    hostname,
  )}&sz=64`;
}

export type ResolvedIcon =
  | { kind: "emoji"; emoji: string }
  | { kind: "image"; src: string }
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
      ? { kind: "image", src: icon }
      : { kind: "emoji", emoji: icon };
  }
  if (homepageUrl) {
    const fav = faviconUrl(homepageUrl);
    if (fav) return { kind: "image", src: fav };
  }
  return { kind: "none" };
}
