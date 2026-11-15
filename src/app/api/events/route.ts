import { getCurrentSession } from "@/auth/session";
import { watchChanges } from "@/core/changes";
import { getDb } from "@/core/db";

const HEARTBEAT_MS = 25_000;
const MAX_STREAM_MS = 10 * 60_000;

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
      // A comment now and then, so proxies don't close the stream when idle.
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      // A proxy can hold the stream open after the browser has gone, so it
      // never hears the disconnect: end each stream in time, and the browser
      // reconnects.
      const expiry = setTimeout(() => {
        stop();
        controller.close();
      }, MAX_STREAM_MS);
      stop = () => {
        clearInterval(heartbeat);
        clearTimeout(expiry);
        unwatch();
      };
      request.signal.addEventListener("abort", () => stop());
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
