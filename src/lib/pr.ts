/** Render a GitHub PR URL as "owner/repo#123", falling back to the raw URL. */
export function prLabel(url: string): string {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (m) return `${m[1]}/${m[2]}#${m[3]}`;
  return url;
}
