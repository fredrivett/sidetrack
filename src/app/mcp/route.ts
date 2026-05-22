import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { verifyApiKey } from "@/core/api-keys";
import { getDb } from "@/core/db";
import { buildServer } from "@/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Auth happens here, not in the proxy: verifyApiKey is a DB lookup
// (sha256 hash match) and we want to keep the proxy free of stateful
// imports. The proxy lets every /mcp request through; we 401 here.
function extractKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() || null;
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
  const userId = verifyApiKey(db, key);
  if (!userId) return new Response("unauthorized", { status: 401 });

  const server = buildServer({ userId });
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
