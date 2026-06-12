import Database from "better-sqlite3";
import { asc } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { backfillItemPrefixes } from "./item-ref-backfill";
import { projects } from "./schema";
import { createTestDb, createTestUser } from "./test-helpers";

// Migrations before the item-short-id one (0006). Applying through 0005 gives
// the pre-prefix schema to seed legacy projects/items against.
const MIGRATIONS_BEFORE_PREFIX = [
  "0000_violet_dark_phoenix",
  "0001_milky_morbius",
  "0002_steady_amphibian",
  "0003_cool_the_stranger",
  "0004_regular_warhawk",
  "0005_slippery_the_santerians",
];
const PREFIX_MIGRATION = "0006_faulty_magneto";

function applyMigration(sqlite: Database.Database, name: string) {
  sqlite.exec(
    readFileSync(
      resolve(process.cwd(), "src/core/migrations", `${name}.sql`),
      "utf8",
    ),
  );
}

describe("0006 migration", () => {
  it("backfills placeholder prefix, item_seq=count, and row-numbered items", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = OFF");
    for (const m of MIGRATIONS_BEFORE_PREFIX) applyMigration(sqlite, m);

    sqlite
      .prepare(
        "INSERT INTO projects (id, user_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("pA", "u1", "Sidetrack", "a0", 1);
    // Items inserted out of creation order to prove numbering follows created_at.
    sqlite
      .prepare(
        "INSERT INTO items (id, project_id, kind, title, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("i2", "pA", "task", "second", "a1", 20);
    sqlite
      .prepare(
        "INSERT INTO items (id, project_id, kind, title, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("i1", "pA", "task", "first", "a0", 10);

    // runMigrations holds FK enforcement OFF for the whole batch; an earlier
    // migration (0004) flips it back ON via its trailing PRAGMA, so re-assert
    // OFF here — otherwise 0006's `DROP TABLE projects` cascades the items away.
    sqlite.pragma("foreign_keys = OFF");
    applyMigration(sqlite, PREFIX_MIGRATION);

    const project = sqlite
      .prepare("SELECT prefix, item_seq FROM projects WHERE id = ?")
      .get("pA") as { prefix: string; item_seq: number };
    expect(project.prefix).toBe("!pA"); // placeholder until TS backfill
    expect(project.item_seq).toBe(2); // == item count

    const items = sqlite
      .prepare("SELECT id, number FROM items ORDER BY number")
      .all() as { id: string; number: number }[];
    expect(items).toEqual([
      { id: "i1", number: 1 }, // earlier created_at → 1
      { id: "i2", number: 2 },
    ]);

    const idx = sqlite.prepare("PRAGMA index_list(items)").all() as {
      name: string;
      unique: number;
    }[];
    expect(idx.find((i) => i.name === "items_project_number")?.unique).toBe(1);
    sqlite.close();
  });
});

describe("backfillItemPrefixes", () => {
  function insertPlaceholder(
    db: ReturnType<typeof createTestDb>["db"],
    id: string,
    userId: string,
    name: string,
    createdAt: number,
  ) {
    db.insert(projects)
      .values({
        id,
        userId,
        name,
        prefix: `!${id}`,
        createdAt,
      })
      .run();
  }

  it("derives prefixes, de-duplicating per owner", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    insertPlaceholder(db, "p1", u, "Sidetrack", 1);
    insertPlaceholder(db, "p2", u, "Sidequest", 2); // same base "SID"
    insertPlaceholder(db, "p3", u, "123", 3); // no letters → "PRJ"

    backfillItemPrefixes(db);

    const rows = db.select().from(projects).orderBy(asc(projects.id)).all();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.p1.prefix).toBe("SID");
    expect(byId.p2.prefix).toBe("SID2");
    expect(byId.p3.prefix).toBe("PRJ");
    for (const r of rows) expect(r.prefix.startsWith("!")).toBe(false);
  });

  it("scopes dedup to the owner — different owners can share a prefix", () => {
    const { db } = createTestDb();
    const alice = createTestUser(db, { email: "alice@test.local" });
    const bob = createTestUser(db, { email: "bob@test.local" });
    insertPlaceholder(db, "pa", alice, "Engineering", 1);
    insertPlaceholder(db, "pb", bob, "Engineering", 2);

    backfillItemPrefixes(db);

    const rows = db.select().from(projects).all();
    expect(rows.find((r) => r.id === "pa")?.prefix).toBe("ENG");
    expect(rows.find((r) => r.id === "pb")?.prefix).toBe("ENG");
  });

  it("never collides with a prefix a real project already holds", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    // A finalized project (non-placeholder) already owns "ENG".
    db.insert(projects)
      .values({ id: "real", userId: u, name: "Engineering", prefix: "ENG" })
      .run();
    insertPlaceholder(db, "p", u, "Engineering", 2); // derives base "ENG"

    backfillItemPrefixes(db);

    const row = db.select().from(projects).all().find((r) => r.id === "p");
    expect(row?.prefix).toBe("ENG2");
  });

  it("is idempotent — a second run changes nothing", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    insertPlaceholder(db, "p1", u, "Sidetrack", 1);
    backfillItemPrefixes(db);
    const first = db.select().from(projects).all().map((r) => r.prefix);
    backfillItemPrefixes(db);
    const second = db.select().from(projects).all().map((r) => r.prefix);
    expect(second).toEqual(first);
  });
});
