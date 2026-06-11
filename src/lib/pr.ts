/**
 * Render a GitHub PR URL as "owner/repo#123", falling back to the raw URL.
 *
 * Validates the host via the URL parser rather than a loose substring match,
 * so a crafted non-GitHub URL (e.g. `https://evil.com/github.com/a/b/pull/1`
 * or `https://github.com.evil.com/a/b/pull/1`) can't be displayed as a trusted
 * GitHub PR label. Mirrors the host/path check in `canonicalizePrUrl`.
 */
export function prLabel(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname === "github.com" || hostname === "www.github.com") {
      const m = pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (m) return `${m[1]}/${m[2]}#${m[3]}`;
    }
  } catch {
    // Not a parseable URL — show it raw rather than guessing a label.
  }
  return url;
}
