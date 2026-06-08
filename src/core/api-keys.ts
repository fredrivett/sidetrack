import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { type ApiKey, apiKeys } from "./auth-schema";
import { recordAudit } from "./audit";
import type { Db } from "./db";
import type { AuditSource } from "./schema";

// API keys are issued from the web UI, stored as sha256(key), and passed in
// MCP requests either via Authorization: Bearer <key> or ?key=<key>.
//
// The full plaintext key is only ever returned at creation time. Subsequent
// listings show the prefix (first 8 chars) for identification.

const KEY_PREFIX = "sk_";
const KEY_BYTES = 32; // 64 hex chars + "sk_" → 67-char key

function hash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generate(): string {
  return KEY_PREFIX + randomBytes(KEY_BYTES).toString("hex");
}

export function createApiKey(
  db: Db,
  userId: string,
  name: string,
  source: AuditSource,
): { record: Omit<ApiKey, "keyHash">; plaintext: string } {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("key name required");
  const plaintext = generate();
  const id = nanoid(12);
  const now = new Date();
  const prefix = plaintext.slice(0, 11);

  db.transaction((tx) => {
    tx.insert(apiKeys)
      .values({
        id,
        userId,
        name: trimmed,
        // First 11 chars: "sk_" + 8 hex. Enough to disambiguate keys in the
        // UI without exposing material that could narrow a brute force.
        prefix,
        keyHash: hash(plaintext),
        createdAt: now,
        lastUsedAt: null,
      })
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "create",
      entityType: "api_key",
      entityId: id,
      detail: `minted API key "${trimmed}" (${prefix}…)`,
    });
  });

  return {
    record: {
      id,
      userId,
      name: trimmed,
      prefix,
      createdAt: now,
      lastUsedAt: null,
    },
    plaintext,
  };
}

export function listApiKeys(
  db: Db,
  userId: string,
): Omit<ApiKey, "keyHash">[] {
  return db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt), asc(apiKeys.id))
    .all();
}

export function revokeApiKey(
  db: Db,
  userId: string,
  id: string,
  source: AuditSource,
): boolean {
  // Pre-read so the audit detail can name the key being revoked. The
  // ownership filter lives on both this read and the delete to make sure
  // we never reveal another user's key existence by audit-side effects.
  const existing = db
    .select({ name: apiKeys.name, prefix: apiKeys.prefix })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .get();
  if (!existing) return false;

  db.transaction((tx) => {
    tx.delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .run();
    recordAudit(tx as unknown as Db, {
      actor: userId,
      source,
      action: "delete",
      entityType: "api_key",
      entityId: id,
      detail: `revoked API key "${existing.name}" (${existing.prefix}…)`,
    });
  });
  return true;
}

/**
 * Resolve a plaintext key to its owning user id. Returns null if the key
 * is unknown. Also bumps last_used_at as a best-effort side effect — a write
 * failure there is swallowed so it can't fail auth for a valid key. Constant-
 * time isn't needed: the lookup is by sha256(key), which is a uniformly-
 * distributed fixed-length string; mismatches all fail at the indexed lookup.
 *
 * Intentionally NOT audited: this fires on every MCP request and would
 * drown the meaningful events. Same carve-out as ensureCategory.
 */
export function verifyApiKey(db: Db, key: string): string | null {
  if (!key || !key.startsWith(KEY_PREFIX)) return null;
  const row = db
    .select({ id: apiKeys.id, userId: apiKeys.userId })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash(key)))
    .get();
  if (!row) return null;
  // last_used_at is best-effort telemetry: a write failure (e.g. SQLITE_BUSY)
  // must not fail auth for an otherwise-valid key.
  try {
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .run();
  } catch {
    // ignore — usage tracking is not load-bearing for auth.
  }
  return row.userId;
}
