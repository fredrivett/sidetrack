import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The 0009 migration introduces per-user ordering: it creates project_positions,
// backfills one row per existing project for its owner (from the old
// projects.position), then drops projects.position. This exercises that data
// migration on pre-0009 data — the production upgrade path, which a fresh-DB
// test (no rows to backfill) never touches.

const MIGRATIONS_DIR = resolve(process.cwd(), "src/core/migrations");
const ORDERING_MIGRATION = "0009_tiny_abomination.sql";

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function applyFile(sqlite: Database.Database, file: string) {
  sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"));
}

describe("0009 per-user ordering migration", () => {
  it("backfills owner position rows, then drops projects.position", () => {
    const sqlite = new Database(":memory:");
    // FK enforcement OFF for the whole batch — earlier rebuild migrations
    // (e.g. 0004) DROP/recreate projects and would cascade rows away otherwise.
    sqlite.pragma("foreign_keys = OFF");
    for (const f of migrationFiles().filter((f) => f < ORDERING_MIGRATION)) {
      applyFile(sqlite, f);
    }

    // Two projects for one owner, plus one for another — pre-0009 schema still
    // has projects.position (user_id has no FK, so no users row is needed).
    const insert = sqlite.prepare(
      "INSERT INTO projects (id, user_id, name, position, prefix) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run("p1", "owner", "A", "a0", "A");
    insert.run("p2", "owner", "B", "a1", "B");
    insert.run("p3", "other", "C", "a0", "C");

    applyFile(sqlite, ORDERING_MIGRATION);

    const rows = sqlite
      .prepare(
        "SELECT user_id, project_id, position FROM project_positions ORDER BY user_id, position",
      )
      .all();
    expect(rows).toEqual([
      { user_id: "other", project_id: "p3", position: "a0" },
      { user_id: "owner", project_id: "p1", position: "a0" },
      { user_id: "owner", project_id: "p2", position: "a1" },
    ]);

    const cols = (
      sqlite.prepare("PRAGMA table_info(projects)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).not.toContain("position");

    sqlite.close();
  });
});
