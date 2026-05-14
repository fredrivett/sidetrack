import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { getDb } from "./db";

let migrated = false;

export function runMigrations() {
  if (migrated) return;
  const { db } = getDb();
  migrate(db, {
    migrationsFolder: resolve(process.cwd(), "src/core/migrations"),
  });
  migrated = true;
}

if (typeof require !== "undefined" && require.main === module) {
  runMigrations();
  console.log("migrations applied");
}
