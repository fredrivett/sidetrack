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
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
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
