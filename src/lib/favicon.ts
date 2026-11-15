// Finds a website's icon the way a browser does, then checks it really is an
// image. Guessing /favicon.ico isn't enough: many sites declare their icon at
// another path in <link rel="icon"> or their web app manifest, and leave a
// framework's default (e.g. Next.js's triangle) at /favicon.ico. Pure apart
// from the fetcher passed in, so tests can give it any site.

export type Fetcher = (
  url: string,
  options: { maxBytes: number },
) => Promise<{
  url: string;
  status: number;
  body: Uint8Array;
  truncated: boolean;
}>;

export type FoundIcon = { contentType: string; body: Uint8Array };

// The icon links sit in <head>, near the top; big pages are cut off here.
const MAX_HTML_BYTES = 512 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ICON_BYTES = 256 * 1024;
// Bounds the work for a site whose candidates all fail.
const MAX_ICON_FETCHES = 8;

// What a size-less icon counts as when ranking. A vector or "any" scales to
// every size, so it beats any bitmap.
const VECTOR_SIZE = 10_000;
const APPLE_TOUCH_SIZE = 180;
const ICO_SIZE = 32;
// A dark-scheme variant is drawn for dark browser chrome; the default or
// light one is what the site shows when nothing is asked for, so prefer it.
const DARK_PENALTY = 100_000;

type Ranked = { href: string; score: number };

/**
 * The icons a page declares, best first, and its web app manifest if it links
 * one. Reads <link rel="icon">, "shortcut icon", and "apple-touch-icon"
 * (+ "-precomposed") tags, honouring <base href>, and skips commented-out
 * tags and markup inside scripts. Ranked by: vector over bitmap, larger
 * declared size over smaller, default/light colour scheme over dark, then
 * document order. A mask-icon (a one-colour silhouette) is not an icon.
 */
export function parseHtmlIcons(
  html: string,
  pageUrl: string,
): { icons: string[]; manifest: string | null } {
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  const tags = [
    ...markup.matchAll(/<(link|base)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi),
  ].map((m) => ({ name: m[1].toLowerCase(), attrs: parseAttributes(m[2]) }));

  let base = pageUrl;
  const baseHref = tags.find((t) => t.name === "base" && t.attrs.href)?.attrs
    .href;
  if (baseHref) base = resolveUrl(baseHref, pageUrl) ?? pageUrl;

  const ranked: Ranked[] = [];
  let manifest: string | null = null;
  for (const { name, attrs } of tags) {
    if (name !== "link" || !attrs.href) continue;
    const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
    const href = resolveUrl(attrs.href, base);
    if (!href) continue;
    if (rel.includes("manifest")) {
      manifest ??= href;
      continue;
    }
    const apple =
      rel.includes("apple-touch-icon") ||
      rel.includes("apple-touch-icon-precomposed");
    if (!rel.includes("icon") && !apple) continue;
    if (attrs.type && !/^image\//i.test(attrs.type)) continue;
    const dark = /prefers-color-scheme\s*:\s*dark/i.test(attrs.media ?? "");
    const size =
      iconSize(href, attrs.type, attrs.sizes) ?? (apple ? APPLE_TOUCH_SIZE : 0);
    ranked.push({ href, score: size - (dark ? DARK_PENALTY : 0) });
  }
  return { icons: best(ranked), manifest };
}

/**
 * The icons in a web app manifest, best first, resolved against the
 * manifest's URL. Skips maskable and monochrome icons, which are drawn to be
 * cropped or tinted by the OS, unless they are also for "any" use. Invalid
 * JSON or a manifest without icons gives [].
 */
export function parseManifestIcons(json: string, manifestUrl: string): string[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(json);
  } catch {
    return [];
  }
  const icons = (manifest as { icons?: unknown } | null)?.icons;
  if (!Array.isArray(icons)) return [];
  const ranked: Ranked[] = [];
  for (const icon of icons as Record<string, unknown>[]) {
    if (typeof icon?.src !== "string") continue;
    const purpose =
      typeof icon.purpose === "string"
        ? icon.purpose.toLowerCase().split(/\s+/)
        : ["any"];
    if (!purpose.includes("any")) continue;
    const href = resolveUrl(icon.src, manifestUrl);
    if (!href) continue;
    const type = typeof icon.type === "string" ? icon.type : undefined;
    const sizes = typeof icon.sizes === "string" ? icon.sizes : undefined;
    ranked.push({ href, score: iconSize(href, type, sizes) ?? 0 });
  }
  return best(ranked);
}

/**
 * The image format of some bytes, as a Content-Type, from their signature
 * rather than what the server claims: servers send favicons as
 * application/octet-stream, and send "not found" pages as 200 text/html.
 * Null when the bytes aren't an image format a browser shows.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (starts(0x00, 0x00, 0x01, 0x00) && bytes.length > 6) return "image/x-icon";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) {
    return "image/avif";
  }
  if (ascii(0, 2) === "BM" && bytes.length > 26) return "image/bmp";
  const text = new TextDecoder()
    .decode(bytes.subarray(0, 4096))
    .replace(/^\uFEFF/, "");
  if (
    /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg[\s>]/i.test(
      text,
    )
  ) {
    return "image/svg+xml";
  }
  return null;
}

/**
 * Find a homepage's icon: the icons its page declares, then its manifest's,
 * then the conventional /favicon.svg, /favicon.ico, /apple-touch-icon.png and
 * /favicon.png, taking the first that downloads as a real image. Paths are
 * resolved against the page the homepage redirects to, so a site that moved
 * to another host or to https is read there. Null when nothing works.
 */
export async function findFavicon(
  homepageUrl: string,
  fetch: Fetcher,
): Promise<FoundIcon | null> {
  let pageUrl = homepageUrl;
  let declared: string[] = [];
  let manifest: string | null = null;
  try {
    const page = await fetch(homepageUrl, { maxBytes: MAX_HTML_BYTES });
    if (page.status >= 200 && page.status < 300) {
      pageUrl = page.url;
      ({ icons: declared, manifest } = parseHtmlIcons(
        new TextDecoder().decode(page.body),
        page.url,
      ));
    }
  } catch {
    // Unreachable page: the conventional paths may still answer.
  }

  const tried = new Set<string>();
  let fetches = 0;
  const tryIcons = async (hrefs: string[]) => {
    for (const href of hrefs) {
      if (tried.has(href)) continue;
      tried.add(href);
      if (href.startsWith("data:")) {
        const icon = decodeDataUrl(href);
        if (icon) return icon;
        continue;
      }
      if (fetches++ >= MAX_ICON_FETCHES) return null;
      try {
        const res = await fetch(href, { maxBytes: MAX_ICON_BYTES });
        if (res.status < 200 || res.status >= 300 || res.truncated) continue;
        const contentType = sniffImageType(res.body);
        if (contentType) return { contentType, body: res.body };
      } catch {
        // Try the next one.
      }
    }
    return null;
  };

  const fromPage = await tryIcons(declared);
  if (fromPage) return fromPage;
  if (manifest && fetches < MAX_ICON_FETCHES) {
    try {
      fetches++;
      const res = await fetch(manifest, { maxBytes: MAX_MANIFEST_BYTES });
      if (res.status >= 200 && res.status < 300 && !res.truncated) {
        const fromManifest = await tryIcons(
          parseManifestIcons(new TextDecoder().decode(res.body), res.url),
        );
        if (fromManifest) return fromManifest;
      }
    } catch {
      // Fall through to the conventional paths.
    }
  }
  const { origin } = new URL(pageUrl);
  return tryIcons([
    `${origin}/favicon.svg`,
    `${origin}/favicon.ico`,
    `${origin}/apple-touch-icon.png`,
    `${origin}/favicon.png`,
  ]);
}

function best(ranked: Ranked[]): string[] {
  // Array.prototype.sort is stable, so equal scores keep document order.
  const hrefs = ranked.sort((a, b) => b.score - a.score).map((r) => r.href);
  return [...new Set(hrefs)];
}

/** The icon's largest declared size, or null when it declares none. */
function iconSize(
  href: string,
  type: string | undefined,
  sizes: string | undefined,
): number | null {
  const path = href.startsWith("data:") ? "" : new URL(href).pathname;
  if (
    /^image\/svg\+xml$/i.test(type ?? "") ||
    href.startsWith("data:image/svg+xml") ||
    /\.svg$/i.test(path)
  ) {
    return VECTOR_SIZE;
  }
  const tokens = (sizes ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.includes("any")) return VECTOR_SIZE;
  const declared = tokens
    .map((t) => /^(\d+)x(\d+)$/.exec(t))
    .filter((m) => m !== null)
    .map((m) => Math.max(Number(m[1]), Number(m[2])));
  if (declared.length > 0) return Math.max(...declared);
  if (/\.ico$/i.test(path) || /icon$/i.test(type ?? "")) return ICO_SIZE;
  return null;
}

/** An absolute http(s) or data:image URL, or null for anything else. */
function resolveUrl(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (/^data:/i.test(trimmed)) {
    return /^data:image\//i.test(trimmed) ? trimmed : null;
  }
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function decodeDataUrl(href: string): FoundIcon | null {
  const m = /^data:([^,]*?)(;base64)?,([\s\S]*)$/i.exec(href);
  if (!m) return null;
  let body: Uint8Array;
  try {
    body = m[2]
      ? Uint8Array.from(Buffer.from(m[3], "base64"))
      : new TextEncoder().encode(decodeURIComponent(m[3]));
  } catch {
    return null;
  }
  if (body.length === 0 || body.length > MAX_ICON_BYTES) return null;
  const contentType = sniffImageType(body);
  return contentType ? { contentType, body } : null;
}

/** Attribute name → decoded value; the first of a repeated name wins. */
function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(
    /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (whole, dec, hex, name) => {
      const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : null;
      if (code === null) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );
}
