import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getEnv } from "../lib/env";
import * as appSchema from "./schema";
import * as authSchema from "./auth-schema";

const schema = { ...appSchema, ...authSchema };

const DB_PATH = getEnv().DB_PATH;

declare global {
  var __sidetrackDb: ReturnType<typeof createDb> | undefined;
}

function createDb() {
  // During `next build`, page-data collection imports modules that open the DB
  // across many parallel workers. Pointing them at the real file makes them
  // race on the WAL-mode write lock (SQLITE_BUSY: "database is locked"). The
  // build never needs real data — it only needs these modules to import — so
  // give each build worker a throwaway in-memory DB instead of the shared file.
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const path = isBuild ? ":memory:" : DB_PATH;
  if (!isBuild) mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(path);
  // Wait for a contended lock rather than failing immediately, so any
  // concurrent open never surfaces as SQLITE_BUSY.
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export function getDb() {
  if (!globalThis.__sidetrackDb) {
    globalThis.__sidetrackDb = createDb();
  }
  return globalThis.__sidetrackDb;
}

export type Db = ReturnType<typeof getDb>["db"];
