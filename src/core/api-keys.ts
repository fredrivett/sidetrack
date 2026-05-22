import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { type ApiKey, apiKeys } from "./auth-schema";
import type { Db } from "./db";

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
): { record: Omit<ApiKey, "keyHash">; plaintext: string } {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("key name required");
  const plaintext = generate();
  const id = nanoid(12);
  const now = new Date();
  db.insert(apiKeys)
    .values({
      id,
      userId,
      name: trimmed,
      // First 11 chars: "sk_" + 8 hex. Enough to disambiguate keys in the UI
      // without exposing material that could narrow a brute force.
      prefix: plaintext.slice(0, 11),
      keyHash: hash(plaintext),
      createdAt: now,
      lastUsedAt: null,
    })
    .run();
  return {
    record: {
      id,
      userId,
      name: trimmed,
      prefix: plaintext.slice(0, 11),
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
): boolean {
  const { changes } = db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .run();
  return changes > 0;
}

/**
 * Resolve a plaintext key to its owning user id. Returns null if the key
 * is unknown. Also updates last_used_at as a side effect (cheap, fire-
 * and-forget — we don't await or surface errors). Constant-time isn't
 * needed: the lookup is by sha256(key), which is a uniformly-distributed
 * fixed-length string; mismatches all fail at the indexed lookup.
 */
export function verifyApiKey(db: Db, key: string): string | null {
  if (!key || !key.startsWith(KEY_PREFIX)) return null;
  const row = db
    .select({ id: apiKeys.id, userId: apiKeys.userId })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash(key)))
    .get();
  if (!row) return null;
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .run();
  return row.userId;
}
