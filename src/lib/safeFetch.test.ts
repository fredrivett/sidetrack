import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPublicAddress, safeFetch } from "./safeFetch";

describe("isPublicAddress", () => {
  it("accepts public IPv4 and IPv6 addresses", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700::6810:85e5")).toBe(true);
    expect(isPublicAddress("2001:4860:4860::8888")).toBe(true);
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });

  it("refuses loopback, private, link-local, metadata and reserved ranges", () => {
    for (const address of [
      "127.0.0.1",
      "127.255.255.254",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "255.255.255.255",
      "224.0.0.1",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "fec0::1", // site-local
      "::127.0.0.1", // IPv4-compatible
      "::7f00:1",
      "64:ff9b::7f00:1", // NAT64
      "2002:7f00:1::", // 6to4
      "2001::1", // Teredo
      "2001:db8::1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("is not fooled by the edges of a private range", () => {
    expect(isPublicAddress("172.15.255.255")).toBe(true);
    expect(isPublicAddress("172.32.0.0")).toBe(true);
    expect(isPublicAddress("100.63.255.255")).toBe(true);
    expect(isPublicAddress("100.128.0.0")).toBe(true);
  });

  it("refuses things that aren't addresses", () => {
    expect(isPublicAddress("localhost")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("safeFetch", () => {
  let server: http.Server;
  let base: string;
  const allowLoopback = () => true;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? "/";
      if (path === "/ok") return res.end("hello");
      if (path === "/auth") return res.end(req.headers.authorization ?? "none");
      if (path.startsWith("/redirect/")) {
        const n = Number(path.split("/")[2]);
        res.writeHead(302, {
          Location: n > 0 ? `/redirect/${n - 1}` : "/ok",
        });
        return res.end();
      }
      if (path === "/to-metadata") {
        res.writeHead(301, { Location: "http://169.254.169.254/latest" });
        return res.end();
      }
      if (path === "/to-file") {
        res.writeHead(302, { Location: "file:///etc/passwd" });
        return res.end();
      }
      if (path === "/gzip") {
        res.writeHead(200, { "Content-Encoding": "gzip" });
        return res.end(zlib.gzipSync("zipped"));
      }
      if (path === "/bomb") {
        res.writeHead(200, { "Content-Encoding": "gzip" });
        return res.end(zlib.gzipSync(Buffer.alloc(10_000_000)));
      }
      if (path === "/endless") {
        const write = () => {
          if (res.write(Buffer.alloc(64 * 1024))) setImmediate(write);
          else res.once("drain", write);
        };
        res.on("close", () => res.removeAllListeners("drain"));
        return write();
      }
      if (path === "/hang") return; // Never answers.
      if (path === "/missing") {
        res.writeHead(404, { "Content-Type": "text/html" });
        return res.end("nope");
      }
      res.writeHead(500);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("refuses a loopback server by default, by IP literal or hostname", async () => {
    await expect(safeFetch(`${base}/ok`, { maxBytes: 100 })).rejects.toThrow(
      /refused address 127\.0\.0\.1/,
    );
    const port = (server.address() as AddressInfo).port;
    await expect(
      safeFetch(`http://localhost:${port}/ok`, { maxBytes: 100 }),
    ).rejects.toThrow(/refused address/);
    await expect(
      safeFetch(`http://[::1]:${port}/ok`, { maxBytes: 100 }),
    ).rejects.toThrow(/refused address ::1/);
  });

  it("fetches when the address is allowed", async () => {
    const res = await safeFetch(`${base}/ok`, {
      maxBytes: 100,
      allowAddress: allowLoopback,
    });
    expect(res.status).toBe(200);
    expect(new TextDecoder().decode(res.body)).toBe("hello");
    expect(res.truncated).toBe(false);
    expect(res.url).toBe(`${base}/ok`);
  });

  it("never sends credentials embedded in the URL", async () => {
    const res = await safeFetch(base.replace("//", "//user:secret@") + "/auth", {
      maxBytes: 100,
      allowAddress: allowLoopback,
    });
    expect(new TextDecoder().decode(res.body)).toBe("none");
    expect(res.url).toBe(`${base}/auth`);
  });

  it("follows redirects and reports the final URL", async () => {
    const res = await safeFetch(`${base}/redirect/2`, {
      maxBytes: 100,
      allowAddress: allowLoopback,
    });
    expect(res.url).toBe(`${base}/ok`);
    expect(new TextDecoder().decode(res.body)).toBe("hello");
  });

  it("gives up after 5 redirects", async () => {
    await expect(
      safeFetch(`${base}/redirect/4`, {
        maxBytes: 100,
        allowAddress: allowLoopback,
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      safeFetch(`${base}/redirect/5`, {
        maxBytes: 100,
        allowAddress: allowLoopback,
      }),
    ).rejects.toThrow(/too many redirects/);
  });

  it("checks every redirect hop, so a public site can't bounce to a private one", async () => {
    const onlyThisServer = (a: string) => a === "127.0.0.1";
    await expect(
      safeFetch(`${base}/to-metadata`, {
        maxBytes: 100,
        allowAddress: onlyThisServer,
      }),
    ).rejects.toThrow(/refused address 169\.254\.169\.254/);
  });

  it("refuses a redirect to a non-http scheme", async () => {
    await expect(
      safeFetch(`${base}/to-file`, {
        maxBytes: 100,
        allowAddress: allowLoopback,
      }),
    ).rejects.toThrow(/refused file:/);
  });

  it("decompresses gzip bodies", async () => {
    const res = await safeFetch(`${base}/gzip`, {
      maxBytes: 100,
      allowAddress: allowLoopback,
    });
    expect(new TextDecoder().decode(res.body)).toBe("zipped");
  });

  it("caps the decompressed size of a compression bomb", async () => {
    const res = await safeFetch(`${base}/bomb`, {
      maxBytes: 1000,
      allowAddress: allowLoopback,
    });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(1000);
  });

  it("cuts off an endless body", async () => {
    const res = await safeFetch(`${base}/endless`, {
      maxBytes: 200_000,
      allowAddress: allowLoopback,
    });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(200_000);
  });

  it("returns error statuses rather than throwing", async () => {
    const res = await safeFetch(`${base}/missing`, {
      maxBytes: 100,
      allowAddress: allowLoopback,
    });
    expect(res.status).toBe(404);
    expect(res.contentType).toBe("text/html");
  });

  it("stops when the signal aborts", async () => {
    await expect(
      safeFetch(`${base}/hang`, {
        maxBytes: 100,
        allowAddress: allowLoopback,
        signal: AbortSignal.timeout(100),
      }),
    ).rejects.toThrow();
  });
});
