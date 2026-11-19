import { getCurrentSession } from "@/auth/session";
import { getDb } from "@/core/db";
import { AI_READS, type AiReadName } from "../reads";

/** Most a request body can be; far more than any read's input. */
const MAX_BODY_BYTES = 64 * 1024;
/** Each read, per user, per minute: well above typing with pauses. */
const PER_MINUTE = 60;

/**
 * One AI read (reads.ts), from the app's own pages. A route rather than a
 * Server Action so it doesn't hold up the page's saves while a model
 * answers. A route doesn't get a Server Action's built-in checks, so this
 * makes them: the request comes from this site, someone is signed in, the
 * body is small and the input valid, and no one asks too often. Failures
 * answer with a bare status; what went wrong reaches the error tracker
 * (instrumentation.ts), not the browser.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/ai/[read]">) {
  const { read: name } = await ctx.params;
  if (!Object.hasOwn(AI_READS, name)) return status(404);
  const read = AI_READS[name as AiReadName];
  if (!sameOrigin(request)) return status(403);
  // Before reading the body, so no one signed out can make it read one.
  const session = await getCurrentSession();
  if (!session) return status(401);
  const userId = session.user.id;
  if (!allow(`${userId}:${name}`)) return status(429);
  const body = await readBody(request);
  if (body === null) return status(413);
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return status(400);
  }
  const input = read.input.safeParse(json);
  if (!input.success) return status(400);
  const signal = request.signal;
  try {
    // `read` is one of the union, which TypeScript can't pair with its own
    // input; the schema above has just checked that it is.
    const result = await read.run(input.data as never, {
      db: getDb().db,
      userId,
      // Stops the model request when the browser stops waiting, such as when
      // newer typing replaces a suggestion, keeping each request's own timeout.
      fetch: (url, init) =>
        fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Nobody is waiting for it, so it's no failure to report.
    if (signal.aborted) return status(499);
    throw error;
  }
}

function status(code: number) {
  return new Response(null, { status: code, headers: { "Cache-Control": "no-store" } });
}

/**
 * Whether the request comes from a page on this host, as Next checks for
 * Server Actions: another site's page can't make a signed-in browser ask
 * (and spend the AI budget), however the session cookie is set.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The body as text, or null once it passes MAX_BODY_BYTES (stopping there). */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Asks in the current minute, by user and read. In memory: Sidetrack runs as
// one process (see changes.ts), and a restart forgetting it costs a minute's
// allowance at most.
const windows = new Map<string, { start: number; count: number }>();

function allow(key: string, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= 60_000) {
    // Drop finished windows now and then, so the map stays small.
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
    }
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= PER_MINUTE;
}
