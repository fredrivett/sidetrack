import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AgentRequest, sendAgentRequest } from "./agentRequest";

const allowLoopback = (address: string) => address === "127.0.0.1" || address === "::1";

describe("sendAgentRequest", () => {
  let server: http.Server;
  let base: string;
  const received: { path: string; headers: http.IncomingHttpHeaders; body: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const path = (req.url ?? "").split("?")[0];
        received.push({ path, headers: req.headers, body });
        if (path === "/ok") res.writeHead(202).end();
        else if (path === "/redirect") res.writeHead(307, { Location: "/ok" }).end();
        else res.writeHead(500).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const request = (path: string): AgentRequest => ({
    url: `${base}${path}?token=hook-credential`,
    secret: "s3cret",
    idempotencyKey: "sess-1",
    body: { type: "stop", sessionId: "sess-1", itemId: "item-1", ref: "SDT-54" },
  });

  it("POSTs the JSON body, signed over the timestamp and body, with its idempotency key", async () => {
    received.length = 0;
    await sendAgentRequest(request("/ok"), { allowAddress: allowLoopback });

    const [got] = received;
    expect(JSON.parse(got.body)).toEqual(request("/ok").body);
    expect(got.headers["content-type"]).toBe("application/json");
    expect(got.headers["idempotency-key"]).toBe("sess-1");
    const timestamp = got.headers["x-sidetrack-timestamp"] as string;
    expect(Math.abs(Number(timestamp) - Date.now() / 1000)).toBeLessThan(5);
    // Computed here, independently of the code under test.
    const expected = createHmac("sha256", "s3cret").update(`${timestamp}.${got.body}`).digest("hex");
    expect(got.headers["x-sidetrack-signature"]).toBe(`sha256=${expected}`);
  });

  it("fails on a non-2xx answer or a redirect, which it doesn't follow, without quoting the URL", async () => {
    received.length = 0;
    await expect(
      sendAgentRequest(request("/redirect"), { allowAddress: allowLoopback }),
    ).rejects.toThrow(/^the agent's webhook answered 307$/);
    expect(received.map((r) => r.path)).toEqual(["/redirect"]);

    await expect(
      sendAgentRequest(request("/fail"), { allowAddress: allowLoopback }),
    ).rejects.toThrow(/answered 500/);
  });

  it("refuses a private address with an error that doesn't contain the URL", async () => {
    const err = await sendAgentRequest(request("/ok")).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("couldn't reach the agent's webhook");
    expect((err as Error).message).not.toContain("hook-credential");
  });
});
