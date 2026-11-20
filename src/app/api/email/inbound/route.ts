import { z } from "zod";
import { getDb } from "@/core/db";
import { receiveEmail, verifyDelivery } from "@/core/emailIn";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payload = z.object({
  to: z.string().min(1),
  from: z.object({ address: z.string().min(1), name: z.string().nullable() }),
  messageId: z.string().min(1),
  subject: z.string(),
  text: z.string(),
  sentAt: z.number().int().nullable(),
});

// The email-in Worker (workers/email-in) posts each email it receives here,
// parsed, and signed with EMAIL_IN_SECRET over the raw body, not a session, so
// the proxy lets /api/email/ through. A 404 tells the Worker to bounce the
// email: no address has that token.
export async function POST(request: Request) {
  const config = getEnv().EMAIL_IN;
  if (!config) return new Response("email in is off on this server", { status: 503 });
  // The signature covers the exact bytes sent, so read the raw text first.
  const body = await request.text();
  if (
    !verifyDelivery(
      config.secret,
      body,
      request.headers.get("x-sidetrack-timestamp"),
      request.headers.get("x-sidetrack-signature"),
    )
  ) {
    return new Response("unauthorized", { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return new Response("body is not JSON", { status: 400 });
  }
  const parsed = payload.safeParse(json);
  if (!parsed.success) return new Response("not an email payload", { status: 400 });
  const { db } = getDb();
  const result = receiveEmail(db, config.domain, parsed.data);
  if (result.status === "unknown") return new Response("no such address", { status: 404 });
  return Response.json(result);
}
