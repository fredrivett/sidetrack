import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getEnv } from "../lib/env";
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

export async function runBackup(): Promise<string> {
  const dir = backupDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const dest = join(dir, `sidetrack-${date}.db`);
  const { sqlite } = getDb();
  await sqlite.backup(dest);
  writeLastBackupAt(Date.now());
  prune(dir);
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
    console.error("[backup] failed:", err);
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
