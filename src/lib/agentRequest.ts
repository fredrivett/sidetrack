// A request to start or stop an agent, sent to the webhook saved on its API
// key (Settings → API keys). Signed with the key's secret, so the receiver,
// such as the Amp dispatcher plugin, can trust that it came from Sidetrack:
//
//   X-Sidetrack-Timestamp: <unix seconds>
//   X-Sidetrack-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>">
//
// The receiver should refuse a signature that doesn't match, or a timestamp
// more than five minutes old, and use Idempotency-Key to drop repeats.

import { createHmac, timingSafeEqual } from "node:crypto";
import { safeFetch } from "./safeFetch";

export type AgentRequestBody =
  | {
      type: "start";
      sessionId: string;
      itemId: string;
      /** The item's ref, such as "SDT-54". */
      ref: string;
      /** The list's GitHub repository, "owner/repo". */
      repository: string;
    }
  | { type: "stop"; sessionId: string; itemId: string; ref: string };

export type AgentRequest = {
  url: string;
  secret: string;
  idempotencyKey: string;
  body: AgentRequestBody;
};

/** The X-Sidetrack-Signature value for a body sent at `timestamp` (seconds). */
export function signAgentRequest(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/**
 * POST the request, resolving once the webhook answers 2xx and rejecting
 * otherwise (any other status, a private address, a network error, or after
 * 5 seconds). Redirects aren't followed. The error never quotes the URL,
 * which is a credential.
 */
export async function sendAgentRequest(
  request: AgentRequest,
  opts: { allowAddress?: (address: string) => boolean } = {},
): Promise<void> {
  const body = JSON.stringify(request.body);
  const timestamp = Math.floor(Date.now() / 1000);
  let status: number;
  try {
    ({ status } = await safeFetch(request.url, {
      maxBytes: 4096,
      allowAddress: opts.allowAddress,
      post: {
        body,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": request.idempotencyKey,
          "X-Sidetrack-Timestamp": String(timestamp),
          "X-Sidetrack-Signature": signAgentRequest(request.secret, timestamp, body),
        },
      },
    }));
  } catch {
    throw new Error("couldn't reach the agent's webhook");
  }
  if (status < 200 || status >= 300) {
    throw new Error(`the agent's webhook answered ${status}`);
  }
}

/** How old a signed request may be when it's received. */
export const MAX_REQUEST_AGE_SECONDS = 5 * 60;

// The shapes Sidetrack sends: a ref is a list prefix (2–5 uppercase letters)
// and an item number, a repository GitHub's owner/repo (normalizeRepository),
// and ids are nanoids.
const REF = /^[A-Z]{2,5}-[1-9][0-9]{0,8}$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The receiving side: check a request's signature and age, then its fields,
 * and return it, or why it was refused. `receivedAt` is when the request
 * arrived, so a receiver that redelivers it later still judges it fresh.
 * Nothing in a refused request is trusted, and the reason never quotes it.
 * The Amp dispatcher plugin (.amp/plugins/sidetrack-dispatch.ts) uses this.
 */
export function readAgentRequest(
  body: Uint8Array,
  headers: Readonly<Record<string, string | undefined>>,
  secret: string,
  receivedAt: Date,
): AgentRequestBody | { refused: string } {
  const timestamp = Number(headers["x-sidetrack-timestamp"]);
  if (!Number.isInteger(timestamp)) return { refused: "no timestamp" };
  const raw = Buffer.from(body).toString("utf8");
  const expected = Buffer.from(signAgentRequest(secret, timestamp, raw));
  const given = Buffer.from(headers["x-sidetrack-signature"] ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { refused: "bad signature" };
  }
  const age = receivedAt.getTime() / 1000 - timestamp;
  if (Math.abs(age) > MAX_REQUEST_AGE_SECONDS) return { refused: "stale timestamp" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { refused: "body isn't JSON" };
  }
  const r = (parsed ?? {}) as Record<string, unknown>;
  const { sessionId, itemId, ref } = r;
  if (typeof sessionId !== "string" || !ID.test(sessionId)) return { refused: "bad sessionId" };
  if (typeof itemId !== "string" || !ID.test(itemId)) return { refused: "bad itemId" };
  if (typeof ref !== "string" || !REF.test(ref)) return { refused: "bad ref" };
  if (r.type === "stop") return { type: "stop", sessionId, itemId, ref };
  if (r.type !== "start") return { refused: "unknown type" };
  if (typeof r.repository !== "string" || !REPOSITORY.test(r.repository)) {
    return { refused: "bad repository" };
  }
  return { type: "start", sessionId, itemId, ref, repository: r.repository };
}
