import { getCurrentSession } from "@/auth/session";
import { getDb } from "@/core/db";
import { readGroups } from "@/core/items";

/** More than a live update names: a drag's or a fold's batch is a list's worth at most. */
const MAX_IDS = 200;

/**
 * The rows a live update names (`?ids=a,b`), with the rest of their
 * checklists (which a reopened or nested row can bring back), as `Saved`, so an open board
 * puts in just those instead of reloading (LiveUpdates). A route, not a
 * Server Action: Next runs a page's actions one at a time, so a read here
 * would wait behind the viewer's saves.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return new Response(null, { status: 401 });
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_IDS) return new Response(null, { status: 400 });
  return Response.json(readGroups(getDb().db, session.user.id, ids), {
    headers: { "Cache-Control": "no-store" },
  });
}
