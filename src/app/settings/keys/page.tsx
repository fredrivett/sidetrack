import type { Metadata } from "next";
import { SettingsHeader } from "@/components/SettingsHeader";
import { ApiKeysPanel } from "@/components/ApiKeysPanel";
import { listAgentWebhooks } from "@/core/agentWebhooks";
import { listApiKeys } from "@/core/api-keys";
import { getDb } from "@/core/db";
import { requireUserId } from "@/auth/session";

export const metadata: Metadata = { title: "API keys" };

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const userId = await requireUserId();
  const { db } = getDb();
  const keys = listApiKeys(db, userId);

  return (
    <>
      <SettingsHeader title="API keys">
        Keys authenticate MCP clients (Claude Desktop, claude.ai
        connectors, scripts). Pass the key via{" "}
        <code className="font-mono">Authorization: Bearer …</code> or{" "}
        <code className="font-mono">?key=…</code> on the{" "}
        <code className="font-mono">/mcp</code> URL.
      </SettingsHeader>
      <ApiKeysPanel initial={keys} webhooks={listAgentWebhooks(db, userId)} />
    </>
  );
}
