import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Migrations that exist *before* the username backfill (0005). 0004 is the one
// that introduces the `users` table, so applying through it gives us the
// pre-username schema to seed against.
const MIGRATIONS_BEFORE_USERNAME = [
  "0000_violet_dark_phoenix",
  "0001_milky_morbius",
  "0002_steady_amphibian",
  "0003_cool_the_stranger",
  "0004_regular_warhawk",
];
const USERNAME_MIGRATION = "0005_slippery_the_santerians";

function applyMigration(sqlite: Database.Database, name: string) {
  const sql = readFileSync(
    resolve(process.cwd(), "src/core/migrations", `${name}.sql`),
    "utf8",
  );
  sqlite.exec(sql);
}

function seedLegacyUser(
  sqlite: Database.Database,
  id: string,
  email: string,
  createdAt: number,
) {
  sqlite
    .prepare(
      "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, "Test", email, 0, createdAt, createdAt);
}

describe("0005 username backfill", () => {
  it("derives unique handles from email for existing users", () => {
    const sqlite = new Database(":memory:");
    // Mirror migrate.ts: FK enforcement off while applying (table rebuilds
    // drop/recreate tables that others reference).
    sqlite.pragma("foreign_keys = OFF");
    for (const m of MIGRATIONS_BEFORE_USERNAME) applyMigration(sqlite, m);

    // created_at controls collision ordering (PARTITION ... ORDER BY created_at).
    seedLegacyUser(sqlite, "a_fred", "fred@fredrivett.com", 1);
    seedLegacyUser(sqlite, "b_jane", "Jane.Doe@example.com", 2);
    seedLegacyUser(sqlite, "c_al", "al@x.com", 3); // local part < 3 chars
    seedLegacyUser(sqlite, "d_bob1", "bob@a.com", 4); // collides with e_bob2
    seedLegacyUser(sqlite, "e_bob2", "Bob@b.com", 5); // later → suffixed
    seedLegacyUser(sqlite, "f_hyphen", "a-b-c@x.com", 6); // hyphens stripped

    applyMigration(sqlite, USERNAME_MIGRATION);
    sqlite.pragma("foreign_keys = ON");

    const rows = sqlite
      .prepare(
        "SELECT id, username, display_username AS displayUsername FROM users",
      )
      .all() as { id: string; username: string; displayUsername: string }[];
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId.a_fred.username).toBe("fred");
    expect(byId.b_jane.username).toBe("jane.doe");
    expect(byId.c_al.username).toBe("al0"); // padded to the 3-char minimum
    expect(byId.d_bob1.username).toBe("bob"); // first writer keeps the base
    expect(byId.e_bob2.username).toBe("bob2"); // collision gets a numeric suffix
    expect(byId.f_hyphen.username).toBe("abc"); // hyphens removed

    // display_username mirrors username for backfilled rows.
    for (const r of rows) expect(r.displayUsername).toBe(r.username);

    // Every handle is unique and non-empty.
    const handles = rows.map((r) => r.username);
    expect(new Set(handles).size).toBe(handles.length);
    expect(handles.every((h) => h.length >= 3)).toBe(true);

    sqlite.close();
  });

  it("makes username NOT NULL and unique at the DB level", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = OFF");
    for (const m of MIGRATIONS_BEFORE_USERNAME) applyMigration(sqlite, m);
    seedLegacyUser(sqlite, "solo", "solo@example.com", 1);
    applyMigration(sqlite, USERNAME_MIGRATION);

    const cols = sqlite.prepare("PRAGMA table_info(users)").all() as {
      name: string;
      notnull: number;
    }[];
    const usernameCol = cols.find((c) => c.name === "username");
    expect(usernameCol?.notnull).toBe(1);

    const indexes = sqlite.prepare("PRAGMA index_list(users)").all() as {
      name: string;
      unique: number;
    }[];
    const usernameIdx = indexes.find((i) => i.name === "users_username_unique");
    expect(usernameIdx?.unique).toBe(1);

    sqlite.close();
  });
});
