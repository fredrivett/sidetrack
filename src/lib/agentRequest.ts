// A request to start or stop an agent, sent to the webhook saved on its API
// key (Settings → API keys). Signed with the key's secret, so the receiver,
// such as the Amp dispatcher plugin, can trust that it came from Sidetrack:
//
//   X-Sidetrack-Timestamp: <unix seconds>
//   X-Sidetrack-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>">
//
// The receiver should refuse a signature that doesn't match, or a timestamp
// more than five minutes old, and use Idempotency-Key to drop repeats.

import { createHmac } from "node:crypto";
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
