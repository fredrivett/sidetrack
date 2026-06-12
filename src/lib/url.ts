// Pure, framework-agnostic helper for the project homepage URL. Display data
// the user types loosely ("example.com", "https://example.com/app"); we store a
// single normalized absolute http(s) URL so the open-in-new-tab link is always
// safe to render. No DB or framework access — string/URL math only.

/**
 * Normalize a user-entered homepage URL. Blank → null (the field is cleared).
 * A bare host gets an `https://` scheme. Returns the canonical absolute URL, or
 * throws on anything that isn't a plausible http(s) web address — a missing dot
 * in the host (likely a typo) or a non-http scheme (e.g. `javascript:`) is
 * rejected so the stored value is always a safe external link.
 */
export function normalizeWebUrl(raw: string, label = "URL"): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`invalid ${label}: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`invalid ${label}: ${raw}`);
  }
  // A scheme-only or single-word value parses but isn't a real host; require a
  // dot so "foo" doesn't silently become "https://foo/".
  if (!parsed.hostname.includes(".")) {
    throw new Error(`invalid ${label}: ${raw}`);
  }
  return parsed.toString();
}

export function normalizeHomepageUrl(raw: string): string | null {
  return normalizeWebUrl(raw, "homepage URL");
}
