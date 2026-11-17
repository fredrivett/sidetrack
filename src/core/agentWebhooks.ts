import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { normalizeWebUrl } from "../lib/url";
import { apiKeys } from "./auth-schema";
import { type AuditOrigin, recordAudit } from "./audit";
import type { Db } from "./db";
import { agentWebhooks } from "./schema";

// Where Sidetrack sends a request to start an API key's agent (see the
// agentWebhooks table). Set from Settings → API keys, by the key's owner.
// Changes are audited against the key, never with the URL or secret in them.

/** A key's webhook as settings shows it: that it's set, never the URL. */
export type AgentWebhookView = { keyId: string; createdAt: number };

export function listAgentWebhooks(db: Db, userId: string): AgentWebhookView[] {
  return db
    .select({ keyId: agentWebhooks.keyId, createdAt: agentWebhooks.createdAt })
    .from(agentWebhooks)
    .innerJoin(apiKeys, eq(apiKeys.id, agentWebhooks.keyId))
    .where(eq(apiKeys.userId, userId))
    .all();
}

function ownKey(db: Db, userId: string, keyId: string) {
  return db
    .select({ name: apiKeys.name })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .get();
}

/**
 * Set the URL that starts the key's agent, replacing any it had, with a new
 * signing secret each time. Returns the secret, the only time it's handed out.
 * The URL must be https: it's a credential, and so is what's signed.
 */
export function setAgentWebhook(
  db: Db,
  userId: string,
  keyId: string,
  rawUrl: string,
  source: AuditOrigin,
): { secret: string } {
  const key = ownKey(db, userId, keyId);
  if (!key) throw new Error(`API key not found: ${keyId}`);
  // normalizeWebUrl's error quotes what it was given; the URL is a
  // credential, so say what's wrong without it.
  let url: string | null;
  try {
    url = normalizeWebUrl(rawUrl, "webhook URL");
  } catch {
    throw new Error("invalid webhook URL");
  }
  if (!url) throw new Error("webhook URL required");
  if (!url.startsWith("https://")) throw new Error("webhook URL must use https");
  const secret = randomBytes(32).toString("hex");
  const now = Date.now();
  db.transaction((tx) => {
    const existing = tx
      .select({ keyId: agentWebhooks.keyId })
      .from(agentWebhooks)
      .where(eq(agentWebhooks.keyId, keyId))
      .get();
    tx.insert(agentWebhooks)
      .values({ keyId, url, secret, createdAt: now })
      .onConflictDoUpdate({
        target: agentWebhooks.keyId,
        set: { url, secret, createdAt: now },
      })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "api_key.webhook.set", keyId, name: key.name, replaced: Boolean(existing) },
    });
  });
  return { secret };
}

/** Stop the key's agent being started from Sidetrack. */
export function removeAgentWebhook(
  db: Db,
  userId: string,
  keyId: string,
  source: AuditOrigin,
): boolean {
  const key = ownKey(db, userId, keyId);
  if (!key) return false;
  const existing = db
    .select({ keyId: agentWebhooks.keyId })
    .from(agentWebhooks)
    .where(eq(agentWebhooks.keyId, keyId))
    .get();
  if (!existing) return false;
  db.transaction((tx) => {
    tx.delete(agentWebhooks).where(eq(agentWebhooks.keyId, keyId)).run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      event: { type: "api_key.webhook.removed", keyId, name: key.name },
    });
  });
  return true;
}
