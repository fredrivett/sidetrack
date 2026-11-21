import { eq } from "drizzle-orm";
import { AwsClient } from "aws4fetch";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sealBackup } from "../lib/backupSeal";
import { getEnv } from "../lib/env";
import { getPostHog } from "../lib/posthog";
import { getDb } from "./db";
import { meta } from "./schema";

const LAST_BACKUP_KEY = "lastBackupAt";
const RETENTION = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

declare global {
  var __sidetrackBackupTimer: NodeJS.Timeout | undefined;
}

function backupDir(): string {
  return getEnv().BACKUP_DIR;
}

function readLastBackupAt(): number | null {
  const { db } = getDb();
  const row = db.select().from(meta).where(eq(meta.key, LAST_BACKUP_KEY)).get();
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

function writeLastBackupAt(ts: number): void {
  const { db } = getDb();
  // audit-exempt: backup scheduler bookkeeping, not a user action.
  db.insert(meta)
    .values({ key: LAST_BACKUP_KEY, value: String(ts) })
    .onConflictDoUpdate({ target: meta.key, set: { value: String(ts) } })
    .run();
}

function prune(dir: string): void {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("sidetrack-") && f.endsWith(".db"))
    .sort()
    .reverse();
  for (const stale of files.slice(RETENTION)) {
    rmSync(join(dir, stale), { force: true });
  }
}

/**
 * Sends a backup off the server, sealed (lib/backupSeal.ts), when
 * BACKUP_UPLOAD is set. Each upload gets its own name and nothing is ever
 * deleted or replaced, so the bucket can refuse both (a bucket lock): a
 * break-in here then can't destroy the backups. The bucket expires old ones.
 */
async function upload(path: string, now: Date): Promise<void> {
  const config = getEnv().BACKUP_UPLOAD;
  if (!config) return;
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const name = `sidetrack-${now.toISOString().replace(/[:.]/g, "-")}.db.gz.enc`;
  const response = await client.fetch(`${config.endpoint}/${config.bucket}/${name}`, {
    method: "PUT",
    body: new Uint8Array(sealBackup(readFileSync(path), config.key)),
  });
  if (!response.ok) {
    throw new Error(`uploading ${name} failed: ${response.status} ${await response.text()}`);
  }
}

export async function runBackup(): Promise<string> {
  const dir = backupDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const now = new Date();
  const dest = join(dir, `sidetrack-${now.toISOString().slice(0, 10)}.db`);
  const { sqlite } = getDb();
  await sqlite.backup(dest);
  writeLastBackupAt(now.getTime());
  prune(dir);
  await upload(dest, now);
  return dest;
}

async function tick(): Promise<void> {
  try {
    const last = readLastBackupAt();
    if (last === null || Date.now() - last >= DAY_MS) {
      const path = await runBackup();
      console.log(`[backup] wrote ${path}`);
    }
  } catch (err) {
    // Reported, not only logged: a backup that quietly stopped is found out
    // only when it's needed.
    console.error("[backup] failed:", err);
    getPostHog()?.captureException(err);
  }
}

export function scheduleBackups(): void {
  if (globalThis.__sidetrackBackupTimer) return;
  // Run once on boot (async, fire-and-forget — server can come up while it runs)
  void tick();
  globalThis.__sidetrackBackupTimer = setInterval(() => {
    void tick();
  }, HOUR_MS);
  // Don't keep the process alive solely because of the timer.
  globalThis.__sidetrackBackupTimer.unref();
}
