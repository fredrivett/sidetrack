import { getCurrentSession } from "@/auth/session";
import { watchChanges } from "@/core/changes";
import { getDb } from "@/core/db";
import { markLooking } from "@/core/presence";

const HEARTBEAT_MS = 25_000;
const MAX_STREAM_MS = 10 * 60_000;

// On SIGTERM, Next stops taking requests and exits once the open ones finish,
// which a stream never does: end them all, so a deploy's old server exits as
// soon as its last save does instead of when Railway kills it. Browsers
// reconnect to the new one (LiveUpdates).
const shutdown = new AbortController();
process.once("SIGTERM", () => shutdown.abort());

/**
 * Live updates: a Server-Sent Events stream that sends a bare `change` event
 * whenever something the viewer sees changes (see watchChanges). It carries
 * no data, so a page that hears one reloads what it shows (LiveUpdates).
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return new Response(null, { status: 401 });
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      const unwatch = watchChanges(getDb().db, session.user.id, () => send("data: change\n\n"));
      // The board holds this open only while it's on screen, so while it's
      // open, notifications go to the inbox without a push.
      const away = markLooking(session.user.id);
      // A comment now and then, so proxies don't close the stream when idle.
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      // A proxy can hold the stream open after the browser has gone, so it
      // never hears the disconnect: end each stream in time, and the browser
      // reconnects.
      const end = () => {
        stop();
        controller.close();
      };
      const expiry = setTimeout(end, MAX_STREAM_MS);
      stop = () => {
        clearInterval(heartbeat);
        clearTimeout(expiry);
        shutdown.signal.removeEventListener("abort", end);
        unwatch();
        away();
      };
      shutdown.signal.addEventListener("abort", end);
      request.signal.addEventListener("abort", () => stop());
      // The browser may have gone during the session lookup, before the
      // listener above: then it never fires.
      if (request.signal.aborted) stop();
      send(": open\n\n");
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      // no-transform keeps compression from buffering the events.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
