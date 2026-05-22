import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { users as authUsers } from "@/core/auth-schema";
import { getDb } from "@/core/db";
import { buildServer } from "@/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  // Phase 3 stopgap: the proxy still gates this endpoint with a single shared
  // MCP_TOKEN env var, so every authenticated request resolves to the same
  // user — pick the first one registered (matches the legacy 'me' adoption).
  // Phase 4 replaces this with per-key lookup via the api_keys table.
  const { db } = getDb();
  const firstUser = db
    .select({ id: authUsers.id })
    .from(authUsers)
    .limit(1)
    .get();
  if (!firstUser) {
    return new Response("no user registered", { status: 503 });
  }

  const server = buildServer({ userId: firstUser.id });
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
