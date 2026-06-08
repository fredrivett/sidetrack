import Link from "next/link";
import { ApiKeysPanel } from "@/components/ApiKeysPanel";
import { listApiKeys } from "@/core/api-keys";
import { getDb } from "@/core/db";
import { requireUserId } from "@/auth/session";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const userId = await requireUserId();
  const { db } = getDb();
  const keys = listApiKeys(db, userId);

  return (
    <main className="min-h-dvh px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-1">
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Back to board
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Keys authenticate MCP clients (Claude Desktop, claude.ai
            connectors, scripts). Pass the key via{" "}
            <code className="font-mono">Authorization: Bearer …</code> or{" "}
            <code className="font-mono">?key=…</code> on the{" "}
            <code className="font-mono">/mcp</code> URL.
          </p>
        </header>
        <ApiKeysPanel initial={keys} />
      </div>
    </main>
  );
}
