import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 0041 retires the "paused" list status: paused lists become archived, each
// with a system audit row. Run on pre-0041 data, the production upgrade path
// a fresh-DB test (no paused lists) misses.

const MIGRATIONS_DIR = resolve(process.cwd(), "src/core/migrations");
const MIGRATION = "0041_paused_lists_archived.sql";

function applyFile(sqlite: Database.Database, file: string) {
  sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"));
}

describe("0041 paused lists become archived", () => {
  it("archives paused lists only, logging each", () => {
    const sqlite = new Database(":memory:");
    // As in runMigrations: earlier rebuilds would cascade rows away with FKs on.
    sqlite.pragma("foreign_keys = OFF");
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      if (f < MIGRATION) applyFile(sqlite, f);
    }
    const insert = sqlite.prepare(
      "INSERT INTO projects (id, user_id, name, prefix, status) VALUES (?, 'u', ?, ?, ?)",
    );
    insert.run("p1", "Home", "HOM", "active");
    insert.run("p2", "Someday", "SOM", "paused");
    insert.run("p3", "Old", "OLD", "archived");

    applyFile(sqlite, MIGRATION);

    expect(sqlite.prepare("SELECT id, status FROM projects ORDER BY id").all()).toEqual([
      { id: "p1", status: "active" },
      { id: "p2", status: "archived" },
      { id: "p3", status: "archived" },
    ]);
    expect(
      sqlite
        .prepare("SELECT actor, source, action, entity_type, entity_id, project_id, detail FROM audit_log")
        .all(),
    ).toEqual([
      {
        actor: "system",
        source: "system",
        action: "update",
        entity_type: "project",
        entity_id: "p2",
        project_id: "p2",
        detail: "Someday: status paused→archived (paused lists are now archived)",
      },
    ]);
    sqlite.close();
  });
});
