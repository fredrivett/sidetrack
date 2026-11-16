import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { verifyApiKey } from "@/core/api-keys";
import { getDb } from "@/core/db";
import { reopenDueRepeats } from "@/core/items";
import { getEnv } from "@/lib/env";
import { buildServer } from "@/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Auth happens here, not in the proxy: verifyApiKey is a DB lookup
// (sha256 hash match) and we want to keep the proxy free of stateful
// imports. The proxy lets every /mcp request through; we 401 here.
function extractKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  // The auth-scheme token is case-insensitive per RFC 7235, so accept any
  // casing of "Bearer" and tolerate extra whitespace before the key.
  const bearer = header?.match(/^Bearer\s+(.+)$/i);
  if (bearer) {
    return bearer[1].trim() || null;
  }
  // claude.ai custom connectors can only put the secret in the URL — they
  // have no way to set a custom request header. Fall back to ?key=.
  const url = new URL(request.url);
  return url.searchParams.get("key");
}

async function handle(request: Request): Promise<Response> {
  const key = extractKey(request);
  if (!key) return new Response("unauthorized", { status: 401 });

  const { db } = getDb();
  const caller = verifyApiKey(db, key);
  if (!caller) return new Response("unauthorized", { status: 401 });
  // Repeating items whose next due day has come reopen before any tool reads,
  // so an agent sees what the board would show.
  reopenDueRepeats(db, caller.userId);

  const server = buildServer({
    userId: caller.userId,
    agent: { keyId: caller.keyId, name: caller.name },
    // As the web actions do: the configured address, else the request's.
    baseUrl: getEnv().BETTER_AUTH_URL?.replace(/\/$/, "") ?? new URL(request.url).origin,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => {});
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
