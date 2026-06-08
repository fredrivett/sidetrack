import Database from "better-sqlite3";
import { asc } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveUsername } from "../lib/username";
import { users } from "./auth-schema";
import { createTestDb } from "./test-helpers";
import { backfillUsernames } from "./username-backfill";

// Migrations before the username one (0005). 0004 introduces `users`, so
// applying through it gives the pre-username schema to seed against.
const MIGRATIONS_BEFORE_USERNAME = [
  "0000_violet_dark_phoenix",
  "0001_milky_morbius",
  "0002_steady_amphibian",
  "0003_cool_the_stranger",
  "0004_regular_warhawk",
];
const USERNAME_MIGRATION = "0005_slippery_the_santerians";

function applyMigration(sqlite: Database.Database, name: string) {
  sqlite.exec(
    readFileSync(
      resolve(process.cwd(), "src/core/migrations", `${name}.sql`),
      "utf8",
    ),
  );
}

function seedLegacyUser(
  sqlite: Database.Database,
  id: string,
  email: string,
) {
  sqlite
    .prepare(
      "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, "Test", email, 0, 1, 1);
}

describe("deriveUsername", () => {
  it("normalizes the email local-part to the allowed charset", () => {
    expect(deriveUsername("fred@fredrivett.com")).toBe("fred");
    expect(deriveUsername("Jane.Doe@example.com")).toBe("jane.doe");
    expect(deriveUsername("al@x.com")).toBe("al0"); // padded to 3 chars
    expect(deriveUsername("a-b-c@x.com")).toBe("abc"); // hyphens stripped
    expect(deriveUsername("bob+work@a.com")).toBe("bobwork"); // plus stripped
  });
});

describe("0005 migration", () => {
  it("rebuilds users with NOT NULL + unique username and placeholder values", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = OFF");
    for (const m of MIGRATIONS_BEFORE_USERNAME) applyMigration(sqlite, m);
    seedLegacyUser(sqlite, "legacy1", "fred@fredrivett.com");
    applyMigration(sqlite, USERNAME_MIGRATION);

    const row = sqlite
      .prepare("SELECT username, display_username FROM users WHERE id = ?")
      .get("legacy1") as { username: string; display_username: string };
    // Placeholder: '!' + id — unique and clearly not a real handle.
    expect(row.username).toBe("!legacy1");
    expect(row.display_username).toBe("!legacy1");

    const cols = sqlite.prepare("PRAGMA table_info(users)").all() as {
      name: string;
      notnull: number;
    }[];
    expect(cols.find((c) => c.name === "username")?.notnull).toBe(1);

    const indexes = sqlite.prepare("PRAGMA index_list(users)").all() as {
      name: string;
      unique: number;
    }[];
    expect(
      indexes.find((i) => i.name === "users_username_unique")?.unique,
    ).toBe(1);
    sqlite.close();
  });
});

describe("backfillUsernames", () => {
  function insertPlaceholder(
    db: ReturnType<typeof createTestDb>["db"],
    id: string,
    email: string,
    createdAt: number,
  ) {
    db.insert(users)
      .values({
        id,
        name: "Test",
        email,
        emailVerified: false,
        username: `!${id}`,
        displayUsername: `!${id}`,
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt),
      })
      .run();
  }

  it("derives unique handles, de-duplicating across colliding bases", () => {
    const { db } = createTestDb();
    insertPlaceholder(db, "p1", "bob@a.com", 1);
    insertPlaceholder(db, "p2", "Bob@b.com", 2); // same base as p1
    insertPlaceholder(db, "p3", "bob2@c.com", 3); // base equals p2's suffixed handle
    insertPlaceholder(db, "p4", "fred@fredrivett.com", 4);

    backfillUsernames(db);

    const rows = db.select().from(users).orderBy(asc(users.id)).all();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.p1.username).toBe("bob");
    expect(byId.p2.username).toBe("bob2");
    // The key case cubic flagged: a suffixed handle must not collide with a
    // different base — p3's "bob2" is already taken, so it becomes "bob22".
    expect(byId.p3.username).toBe("bob22");
    expect(byId.p4.username).toBe("fred");

    // display_username mirrors username; all handles unique; none placeholders.
    for (const r of rows) {
      expect(r.displayUsername).toBe(r.username);
      expect(r.username.startsWith("!")).toBe(false);
    }
    expect(new Set(rows.map((r) => r.username)).size).toBe(rows.length);
  });

  it("never collides with a handle a real user already chose", () => {
    const { db } = createTestDb();
    // A finalized sign-up (no placeholder) owns "dave".
    db.insert(users)
      .values({
        id: "real",
        name: "Dave",
        email: "dave-real@x.com",
        emailVerified: false,
        username: "dave",
        displayUsername: "Dave",
        createdAt: new Date(1),
        updatedAt: new Date(1),
      })
      .run();
    insertPlaceholder(db, "p", "dave@y.com", 2); // derives base "dave"

    backfillUsernames(db);

    const row = db.select().from(users).all().find((r) => r.id === "p");
    expect(row?.username).toBe("dave2"); // skips the taken "dave"
  });

  it("is idempotent — a second run changes nothing", () => {
    const { db } = createTestDb();
    insertPlaceholder(db, "p1", "bob@a.com", 1);
    backfillUsernames(db);
    const first = db.select().from(users).all().map((r) => r.username);
    backfillUsernames(db);
    const second = db.select().from(users).all().map((r) => r.username);
    expect(second).toEqual(first);
  });
});
