// Pure, framework-agnostic helpers for item short IDs (display refs like
// `SID-42`). The human ref is derived display data — never an identity anchor —
// so everything here is string math with no DB access. Shared by the core
// resolver, the project prefix lifecycle, and the migration backfill.

export const PREFIX_MIN = 2;
export const PREFIX_MAX = 5;
// User-facing prefixes are uppercase letters only. Auto-suffixed prefixes
// (collision handling) may additionally contain trailing digits, e.g. `ENG2`;
// those are system-generated and intentionally skip this validator.
export const PREFIX_RE = /^[A-Z]+$/;

/**
 * Derive a default prefix from a project name: uppercase letters only, first
 * three, padded to the minimum length. Falls back to "PRJ" when the name has no
 * letters. The result is not guaranteed unique — callers de-duplicate it with
 * dedupePrefix against the owner's existing prefixes.
 */
export function derivePrefix(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length === 0) return "PRJ";
  return letters.slice(0, 3).padEnd(PREFIX_MIN, "X");
}

/**
 * Given a base prefix and the set of already-taken prefixes (same namespace),
 * return the base if free, otherwise the base with a numeric suffix (`ENG`,
 * `ENG2`, `ENG3`, …). The base is trimmed to fit the suffix within PREFIX_MAX,
 * but its leading letter is always kept so the result stays a parseable,
 * letter-led prefix (never digit-only) — both invariants hold for any realistic
 * collision count. `taken` is matched verbatim, so callers pass uppercase values.
 */
export function dedupePrefix(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  for (;;) {
    const suffix = String(n);
    const candidate =
      base.slice(0, Math.max(1, PREFIX_MAX - suffix.length)) + suffix;
    if (!taken.has(candidate)) return candidate;
    n += 1;
  }
}

/** Returns a human-readable error string, or null if the prefix is well-formed. */
export function validatePrefix(value: string): string | null {
  if (value.length < PREFIX_MIN) return `At least ${PREFIX_MIN} letters.`;
  if (value.length > PREFIX_MAX) return `At most ${PREFIX_MAX} letters.`;
  if (!PREFIX_RE.test(value)) return "Uppercase letters only.";
  return null;
}

/** Canonical display ref for an item, e.g. ("SID", 42) → "SID-42". */
export function formatItemRef(prefix: string, number: number): string {
  return `${prefix}-${number}`;
}

export type ParsedItemRef = {
  /** Lowercased workspace qualifier from `username/PREFIX-N`, or null if bare. */
  username: string | null;
  /** Uppercased prefix. */
  prefix: string;
  number: number;
};

// Bare ref: a 2–5 char prefix (a letter then letters/digits — the digits let
// auto-suffixed prefixes like `ENG2` resolve), a dash, an optional `#`, optional
// space, then digits. Case-insensitive and whitespace-tolerant so a pasted
// "eng-42" / "ENG-#42" still resolves. The qualifier (`username/…`) is split off
// first.
const BARE_RE = /^([A-Za-z][A-Za-z0-9]{1,4})-#?\s*(\d+)$/;

/**
 * Parse a possibly-qualified ref string into its parts, or null if it isn't a
 * well-formed ref. Accepts bare `ENG-42` and qualified `fred/ENG-42`. A raw
 * nanoid is *not* a ref and returns null — the resolver handles that fallback.
 */
export function parseItemRef(raw: string): ParsedItemRef | null {
  const trimmed = raw.trim();
  let username: string | null = null;
  let rest = trimmed;
  const slash = trimmed.indexOf("/");
  if (slash !== -1) {
    username = trimmed.slice(0, slash).trim().toLowerCase();
    rest = trimmed.slice(slash + 1).trim();
    if (username.length === 0) return null;
  }
  const m = rest.match(BARE_RE);
  if (!m) return null;
  const number = Number.parseInt(m[2], 10);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { username, prefix: m[1].toUpperCase(), number };
}
