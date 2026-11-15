import { getDb } from "@/core/db";
import { applyPullRequestEvent, verifyGithubDelivery } from "@/core/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GitHub posts repository events here (see Settings → GitHub). Authenticated
// by the webhook's signature over the raw body, not a session, so the proxy
// lets /api/github/ through. Only `pull_request` events change anything.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // The signature covers the exact bytes GitHub sent, so read the raw text
  // before parsing it.
  const body = await request.text();
  const { db } = getDb();
  const caller = verifyGithubDelivery(
    db,
    id,
    body,
    request.headers.get("x-hub-signature-256"),
  );
  if (!caller) return new Response("unauthorized", { status: 401 });

  const event = request.headers.get("x-github-event");
  if (event === "ping") return Response.json({ ok: true });
  if (event !== "pull_request") {
    return Response.json({ ignored: event }, { status: 202 });
  }

  let pr: { action?: unknown; pull_request?: Record<string, unknown> } | null;
  try {
    pr = JSON.parse(body);
  } catch {
    return new Response("body is not JSON; set the content type to application/json", {
      status: 400,
    });
  }
  const p = pr?.pull_request;
  if (typeof pr?.action !== "string" || typeof p?.title !== "string" || typeof p.html_url !== "string") {
    return new Response("not a pull_request payload", { status: 400 });
  }
  return Response.json(
    applyPullRequestEvent(db, caller.userId, {
      action: pr.action,
      merged: p.merged === true,
      title: p.title,
      url: p.html_url,
    }),
  );
}
