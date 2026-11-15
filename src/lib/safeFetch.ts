// A GET for URLs that users supply (e.g. a list's homepage), made by the
// server. Without care, that is server-side request forgery: a homepage of
// http://169.254.169.254/ or http://localhost:3000/ would have the server read
// its own cloud metadata or internal services. So every connection, including
// each redirect hop, may only reach a public address. The check runs inside
// the socket's DNS lookup, on the very address it connects to, so a hostname
// that resolves to a public address for a check and then a private one for the
// connection (DNS rebinding) can't slip through.

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import zlib from "node:zlib";

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
] as const) {
  PRIVATE.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64, which can embed a private IPv4 address
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, which can embed a private IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  PRIVATE.addSubnet(net, prefix, "ipv6");
}

/**
 * Whether an IP address is on the public internet. IPv4-mapped IPv6 addresses
 * (::ffff:127.0.0.1) are checked as the IPv4 address they carry. Anything that
 * isn't an IP address is not public.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !PRIVATE.check(address, family === 4 ? "ipv4" : "ipv6");
}

export type SafeFetchResult = {
  /** The URL that answered, after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: Uint8Array;
  /** The body was longer than `maxBytes` and was cut off there. */
  truncated: boolean;
};

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 5_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * GET an http(s) URL from a public address, following up to 5 redirects. The
 * body is decompressed and cut off after `maxBytes`, so a huge or endless
 * response can't exhaust memory. Rejects on a non-public address, a non-http
 * redirect, too many redirects, a network error, or after 5 seconds (or when
 * `signal` aborts). `allowAddress` exists for tests, which serve from
 * loopback; leave it at its default.
 */
export async function safeFetch(
  url: string,
  {
    maxBytes,
    signal,
    allowAddress = isPublicAddress,
  }: {
    maxBytes: number;
    signal?: AbortSignal;
    allowAddress?: (address: string) => boolean;
  },
): Promise<SafeFetchResult> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let current = new URL(url);
  for (let hop = 0; ; hop++) {
    const res = await get(current, maxBytes, abort, allowAddress);
    const location = res.location;
    if (!REDIRECT_STATUSES.has(res.status) || location === undefined) {
      return { ...res, url: current.toString() };
    }
    if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
    current = new URL(location, current);
  }
}

function get(
  url: URL,
  maxBytes: number,
  signal: AbortSignal,
  allowAddress: (address: string) => boolean,
): Promise<Omit<SafeFetchResult, "url"> & { location?: string }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Promise.reject(new Error(`refused ${url.protocol} URL`));
  }
  // An IP-literal host connects without a DNS lookup, so check it here.
  const literal = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(literal) && !allowAddress(literal)) {
    return Promise.reject(new Error(`refused address ${literal}`));
  }
  const lookup: typeof dnsLookup = ((
    hostname: string,
    options: { all?: boolean },
    callback: (
      err: Error | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      // Refuse the host outright if any address is private, rather than
      // picking a public one, so its DNS can't steer the choice.
      const refused = addresses.find((a) => !allowAddress(a.address));
      if (refused || addresses.length === 0) {
        return callback(
          new Error(`refused address ${refused?.address ?? "(none)"}`),
          [],
        );
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  }) as typeof dnsLookup;

  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "GET",
        lookup,
        signal,
        headers: {
          // Some sites refuse requests without a browser-like agent.
          "User-Agent":
            "Mozilla/5.0 (compatible; SidetrackFavicon/1.0; +https://sidetrack.it)",
          Accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        const contentType = res.headers["content-type"] ?? "";
        if (REDIRECT_STATUSES.has(status) && location !== undefined) {
          res.destroy();
          resolve({
            status,
            location,
            contentType,
            body: new Uint8Array(),
            truncated: false,
          });
          return;
        }
        const encoding = (res.headers["content-encoding"] ?? "")
          .trim()
          .toLowerCase();
        const stream =
          encoding === "gzip" || encoding === "x-gzip"
            ? res.pipe(zlib.createGunzip())
            : encoding === "deflate"
              ? res.pipe(zlib.createInflate())
              : encoding === "br"
                ? res.pipe(zlib.createBrotliDecompress())
                : res;
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = (truncated: boolean) => {
          if (done) return;
          done = true;
          const body = Buffer.concat(chunks).subarray(0, maxBytes);
          resolve({ status, contentType, body, truncated });
        };
        stream.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          // Cap the decompressed size, so a small compressed bomb can't
          // inflate past it either.
          if (size > maxBytes) {
            finish(true);
            res.destroy();
            if (stream !== res) stream.destroy();
          }
        });
        stream.on("end", () => finish(false));
        // Closed without an end: the connection dropped mid-body.
        stream.on("close", () => {
          if (!done) reject(new Error("connection closed"));
        });
        stream.on("error", (err) => {
          if (!done) reject(err);
        });
        res.on("error", (err) => {
          if (!done) reject(err);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
