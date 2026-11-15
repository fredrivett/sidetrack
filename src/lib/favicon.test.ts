import { describe, expect, it } from "vitest";
import {
  type Fetcher,
  findFavicon,
  parseHtmlIcons,
  parseManifestIcons,
  sniffImageType,
} from "./favicon";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const ICO = Uint8Array.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
);
const HTML_404 = new TextEncoder().encode("<!doctype html><h1>Not found</h1>");

describe("parseHtmlIcons", () => {
  const page = "https://example.com/app/index.html";

  it("resolves relative, root-relative, protocol-relative and absolute hrefs", () => {
    const { icons } = parseHtmlIcons(
      `<link rel="icon" href="a.png" sizes="16x16">
       <link rel="icon" href="/b.png" sizes="32x32">
       <link rel="icon" href="//cdn.example.net/c.png" sizes="48x48">
       <link rel="icon" href="https://other.org/d.png" sizes="64x64">`,
      page,
    );
    expect(icons).toEqual([
      "https://other.org/d.png",
      "https://cdn.example.net/c.png",
      "https://example.com/b.png",
      "https://example.com/app/a.png",
    ]);
  });

  it("prefers the default/light icon over a dark-scheme one (abode.fyi)", () => {
    const { icons, manifest } = parseHtmlIcons(
      `<link rel="manifest" href="/manifest.webmanifest"/>
       <link rel="icon" href="/favicon-dark.png" type="image/png" media="(prefers-color-scheme: dark)"/>
       <link rel="icon" href="/favicon-light.png" type="image/png" media="(prefers-color-scheme: light)"/>
       <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"/>`,
      "https://abode.fyi/",
    );
    expect(icons).toEqual([
      "https://abode.fyi/icons/apple-touch-icon.png",
      "https://abode.fyi/favicon-light.png",
      "https://abode.fyi/favicon-dark.png",
    ]);
    expect(manifest).toBe("https://abode.fyi/manifest.webmanifest");
  });

  it("ranks svg over bitmaps, bigger sizes over smaller, ico as 32px", () => {
    const { icons } = parseHtmlIcons(
      `<link rel="shortcut icon" href="/favicon.ico">
       <link rel="icon" href="/16.png" sizes="16x16">
       <link rel="icon" href="/192.png" sizes="192x192">
       <link rel="icon" href="/multi.png" sizes="16x16 512x512">
       <link rel="icon" href="/logo.svg">
       <link rel="apple-touch-icon-precomposed" href="/touch.png">`,
      page,
    );
    expect(icons).toEqual([
      "https://example.com/logo.svg",
      "https://example.com/multi.png",
      "https://example.com/192.png",
      "https://example.com/touch.png",
      "https://example.com/favicon.ico",
      "https://example.com/16.png",
    ]);
  });

  it("treats sizes=any and type=image/svg+xml as vector", () => {
    const { icons } = parseHtmlIcons(
      `<link rel="icon" href="/big.png" sizes="512x512">
       <link rel="icon" href="/icon?v=2" type="image/svg+xml">
       <link rel="icon" href="/any.png" sizes="any">`,
      page,
    );
    expect(icons.slice(0, 2)).toEqual([
      "https://example.com/icon?v=2",
      "https://example.com/any.png",
    ]);
  });

  it("honours <base href>", () => {
    const { icons } = parseHtmlIcons(
      `<base href="https://static.example.com/assets/"><link rel="icon" href="fav.png">`,
      page,
    );
    expect(icons).toEqual(["https://static.example.com/assets/fav.png"]);
  });

  it("accepts any attribute order, case, quoting, and entity-encoded hrefs", () => {
    const { icons } = parseHtmlIcons(
      `<LINK HREF='/a.png?x=1&amp;y=2' REL='Shortcut Icon'>
       <link href=/b.png rel=icon />`,
      page,
    );
    expect(icons).toEqual([
      "https://example.com/a.png?x=1&y=2",
      "https://example.com/b.png",
    ]);
  });

  it("handles a '>' inside a quoted attribute", () => {
    const { icons } = parseHtmlIcons(
      `<link rel="icon" media="(min-width: 1px) and (x > 0)" href="/gt.png">`,
      page,
    );
    expect(icons).toEqual(["https://example.com/gt.png"]);
  });

  it("ignores commented-out tags, tags inside scripts, and non-icon links", () => {
    const { icons, manifest } = parseHtmlIcons(
      `<!-- <link rel="icon" href="/commented.png"> -->
       <script>document.write('<link rel="icon" href="/scripted.png">')</script>
       <link rel="stylesheet" href="/style.css">
       <link rel="mask-icon" href="/mask.svg" color="#000">
       <link rel="preload" href="/icon.png" as="image">
       <link rel="icon" href="/real.png">`,
      page,
    );
    expect(icons).toEqual(["https://example.com/real.png"]);
    expect(manifest).toBeNull();
  });

  it("skips non-image types and unsafe schemes but keeps data:image URLs", () => {
    const { icons } = parseHtmlIcons(
      `<link rel="icon" href="/x.txt" type="text/plain">
       <link rel="icon" href="javascript:alert(1)">
       <link rel="icon" href="data:text/html,hi">
       <link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">`,
      page,
    );
    expect(icons).toEqual(["data:image/svg+xml,%3Csvg%3E%3C/svg%3E"]);
  });

  it("dedupes the same icon declared twice and drops #fragments", () => {
    const { icons } = parseHtmlIcons(
      `<link rel="icon" href="/a.png#one"><link rel="shortcut icon" href="/a.png">`,
      page,
    );
    expect(icons).toEqual(["https://example.com/a.png"]);
  });

  it("returns nothing for a page without icons", () => {
    expect(parseHtmlIcons("<html><head></head></html>", page)).toEqual({
      icons: [],
      manifest: null,
    });
  });
});

describe("parseManifestIcons", () => {
  const url = "https://example.com/static/site.webmanifest";

  it("ranks by size, resolves against the manifest, skips maskable/monochrome", () => {
    expect(
      parseManifestIcons(
        JSON.stringify({
          icons: [
            { src: "icon-192.png", sizes: "192x192" },
            { src: "icon-512.png", sizes: "512x512" },
            { src: "mask.png", sizes: "1024x1024", purpose: "maskable" },
            { src: "mono.png", sizes: "1024x1024", purpose: "monochrome" },
            { src: "/both.png", sizes: "256x256", purpose: "maskable any" },
          ],
        }),
        url,
      ),
    ).toEqual([
      "https://example.com/static/icon-512.png",
      "https://example.com/both.png",
      "https://example.com/static/icon-192.png",
    ]);
  });

  it("returns [] for invalid JSON, no icons, or malformed entries", () => {
    expect(parseManifestIcons("{nope", url)).toEqual([]);
    expect(parseManifestIcons("null", url)).toEqual([]);
    expect(parseManifestIcons('{"icons":"x"}', url)).toEqual([]);
    expect(parseManifestIcons('{"icons":[null,{"src":3},{}]}', url)).toEqual(
      [],
    );
  });
});

describe("sniffImageType", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it("recognises image signatures", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(ICO)).toBe("image/x-icon");
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    expect(sniffImageType(bytes("GIF89a......"))).toBe("image/gif");
    expect(sniffImageType(bytes("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(bytes("\0\0\0\x1cftypavif"))).toBe("image/avif");
    expect(sniffImageType(bytes("BM" + "\0".repeat(30)))).toBe("image/bmp");
  });

  it("recognises SVG behind a BOM, XML prolog, comments and doctype", () => {
    expect(sniffImageType(SVG)).toBe("image/svg+xml");
    expect(
      sniffImageType(
        bytes(
          '\uFEFF<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<SVG viewBox="0 0 1 1"/>',
        ),
      ),
    ).toBe("image/svg+xml");
  });

  it("rejects HTML (a soft 404), text, and empty or truncated bodies", () => {
    expect(sniffImageType(HTML_404)).toBeNull();
    expect(sniffImageType(bytes("<html><svg></svg></html>"))).toBeNull();
    expect(sniffImageType(bytes("not an image"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(Uint8Array.from([0, 0, 1, 0]))).toBeNull();
  });
});

/** A fake site: URL → response. Unknown URLs 404 with an HTML page. */
function site(
  routes: Record<
    string,
    | { body: Uint8Array | string; status?: number; url?: string }
    | Error
  >,
) {
  const requested: string[] = [];
  const fetcher: Fetcher = async (url) => {
    requested.push(url);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (!route) return { url, status: 404, body: HTML_404, truncated: false };
    const body =
      typeof route.body === "string"
        ? new TextEncoder().encode(route.body)
        : route.body;
    return {
      url: route.url ?? url,
      status: route.status ?? 200,
      body,
      truncated: false,
    };
  };
  return { fetcher, requested };
}

describe("findFavicon", () => {
  it("finds abode.fyi's declared light icon, not the framework /favicon.ico", async () => {
    const { fetcher, requested } = site({
      "https://abode.fyi/": {
        body: `<link rel="icon" href="/favicon-light.png" type="image/png" media="(prefers-color-scheme: light)"/>
               <link rel="icon" href="/favicon-dark.png" type="image/png" media="(prefers-color-scheme: dark)"/>`,
      },
      "https://abode.fyi/favicon-light.png": { body: PNG },
      "https://abode.fyi/favicon.ico": { body: ICO },
    });
    expect(await findFavicon("https://abode.fyi/", fetcher)).toEqual({
      contentType: "image/png",
      body: PNG,
    });
    expect(requested).toEqual([
      "https://abode.fyi/",
      "https://abode.fyi/favicon-light.png",
    ]);
  });

  it("skips a declared icon that 404s or is a soft-404 HTML page", async () => {
    const { fetcher } = site({
      "https://x.com/": {
        body: `<link rel="icon" href="/gone.svg"><link rel="icon" href="/soft.png" sizes="64x64"><link rel="icon" href="/ok.png" sizes="32x32">`,
      },
      "https://x.com/soft.png": { body: HTML_404 },
      "https://x.com/ok.png": { body: PNG },
    });
    expect((await findFavicon("https://x.com/", fetcher))?.body).toBe(PNG);
  });

  it("falls back to the manifest's icons", async () => {
    const { fetcher } = site({
      "https://x.com/": { body: `<link rel="manifest" href="/m.json">` },
      "https://x.com/m.json": {
        body: JSON.stringify({ icons: [{ src: "/icon-512.png", sizes: "512x512" }] }),
      },
      "https://x.com/icon-512.png": { body: PNG },
      "https://x.com/favicon.ico": { body: ICO },
    });
    expect((await findFavicon("https://x.com/", fetcher))?.body).toBe(PNG);
  });

  it("falls back to the conventional paths, svg first", async () => {
    const { fetcher } = site({
      "https://x.com/": { body: "<html></html>" },
      "https://x.com/favicon.svg": { body: SVG },
      "https://x.com/favicon.ico": { body: ICO },
    });
    expect(await findFavicon("https://x.com/", fetcher)).toEqual({
      contentType: "image/svg+xml",
      body: SVG,
    });
  });

  it("tries /apple-touch-icon.png and /favicon.png after /favicon.ico", async () => {
    const { fetcher, requested } = site({
      "https://x.com/": { body: "" },
      "https://x.com/favicon.png": { body: PNG },
    });
    expect((await findFavicon("https://x.com/", fetcher))?.body).toBe(PNG);
    expect(requested.slice(1)).toEqual([
      "https://x.com/favicon.svg",
      "https://x.com/favicon.ico",
      "https://x.com/apple-touch-icon.png",
      "https://x.com/favicon.png",
    ]);
  });

  it("reads the page the homepage redirected to, on its new host", async () => {
    const { fetcher } = site({
      "http://old.com/": {
        url: "https://new.com/home",
        body: "<html></html>",
      },
      "https://new.com/favicon.ico": { body: ICO },
      "http://old.com/favicon.ico": { body: PNG },
    });
    expect((await findFavicon("http://old.com/", fetcher))?.body).toBe(ICO);
  });

  it("tries the conventional paths on the new host when the redirect target errors", async () => {
    const { fetcher } = site({
      "http://old.com/": {
        url: "https://new.com/home",
        status: 500,
        body: "oops",
      },
      "https://new.com/favicon.ico": { body: ICO },
      "http://old.com/favicon.ico": { body: PNG },
    });
    expect((await findFavicon("http://old.com/", fetcher))?.body).toBe(ICO);
  });

  it("still tries the conventional paths when the page is down", async () => {
    const { fetcher } = site({
      "https://x.com/app": new Error("ECONNRESET"),
      "https://x.com/favicon.ico": { body: ICO },
    });
    expect((await findFavicon("https://x.com/app", fetcher))?.body).toBe(ICO);
  });

  it("ignores a page that answers with an error status", async () => {
    const { fetcher, requested } = site({
      "https://x.com/": {
        status: 503,
        body: `<link rel="icon" href="/from-error-page.png">`,
      },
      "https://x.com/from-error-page.png": { body: PNG },
      "https://x.com/favicon.ico": { body: ICO },
    });
    expect((await findFavicon("https://x.com/", fetcher))?.body).toBe(ICO);
    expect(requested).not.toContain("https://x.com/from-error-page.png");
  });

  it("decodes an inline data: icon without fetching it, whatever the scheme's case", async () => {
    const { fetcher, requested } = site({
      "https://x.com/": {
        body: `<link rel="icon" href="DATA:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E">`,
      },
    });
    expect((await findFavicon("https://x.com/", fetcher))?.contentType).toBe(
      "image/svg+xml",
    );
    expect(requested).toEqual(["https://x.com/"]);
  });

  it("skips a truncated (too large) icon", async () => {
    const { fetcher } = site({
      "https://x.com/": { body: `<link rel="icon" href="/huge.png">` },
      "https://x.com/favicon.ico": { body: ICO },
    });
    const truncating: Fetcher = async (url, o) => {
      const res = await fetcher(url, o);
      return url.endsWith("/huge.png")
        ? { ...res, status: 200, body: PNG, truncated: true }
        : res;
    };
    expect((await findFavicon("https://x.com/", truncating))?.body).toBe(ICO);
  });

  it("still reaches the manifest and /favicon.ico after many broken declared icons", async () => {
    const links = Array.from(
      { length: 20 },
      (_, i) => `<link rel="icon" href="/i${i}.png">`,
    ).join("");
    const { fetcher, requested } = site({
      "https://x.com/": { body: `${links}<link rel="manifest" href="/m.json">` },
      "https://x.com/m.json": {
        body: JSON.stringify({
          icons: Array.from({ length: 10 }, (_, i) => ({ src: `/m${i}.png` })),
        }),
      },
      "https://x.com/favicon.ico": { body: ICO },
    });
    expect((await findFavicon("https://x.com/", fetcher))?.body).toBe(ICO);
    // The page, 4 declared icons, the manifest, 3 of its icons, then
    // /favicon.svg and /favicon.ico.
    expect(requested.length).toBe(1 + 4 + 1 + 3 + 2);
  });

  it("returns null when nothing is an image, and bounds the requests", async () => {
    const links = Array.from(
      { length: 20 },
      (_, i) => `<link rel="icon" href="/i${i}.png">`,
    ).join("");
    const { fetcher, requested } = site({ "https://x.com/": { body: links } });
    expect(await findFavicon("https://x.com/", fetcher)).toBeNull();
    // The page, 4 declared icons, then the 4 conventional paths.
    expect(requested.length).toBe(9);
  });

  it("never requests the same URL twice", async () => {
    const { fetcher, requested } = site({
      "https://x.com/": {
        body: `<link rel="icon" href="/favicon.ico"><link rel="manifest" href="/m.json">`,
      },
      "https://x.com/m.json": {
        body: JSON.stringify({ icons: [{ src: "/favicon.ico" }] }),
      },
    });
    expect(await findFavicon("https://x.com/", fetcher)).toBeNull();
    expect(new Set(requested).size).toBe(requested.length);
  });
});
