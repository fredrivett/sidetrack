import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const PROJECT_STATUSES = [
  "idea",
  "pre-launch",
  "early-access",
  "launched",
  "paused",
  "dormant",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ITEM_KINDS = ["task", "milestone"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const AUDIT_SOURCES = ["web", "mcp", "github"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "complete",
  "uncomplete",
  "reorder",
  "delete",
  "link",
  "unlink",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITIES = [
  "project",
  "item",
  "category",
  "api_key",
  "member",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

// A membership starts `pending` (an invite the target hasn't answered) and
// becomes `accepted` once they accept. Only `accepted` rows grant access —
// see hasProjectAccess. Declining/removing deletes the row outright.
export const MEMBERSHIP_STATUSES = ["pending", "accepted"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    status: text("status").$type<ProjectStatus>().notNull().default("idea"),
    summary: text("summary").notNull().default(""),
    summaryUpdatedAt: integer("summary_updated_at"),
    // Optional public homepage / landing URL. Normalized to an absolute
    // http(s) URL on write (see normalizeHomepageUrl); null when unset.
    homepageUrl: text("homepage_url"),
    // Optional project icon: either an emoji grapheme (e.g. "🚀") or an
    // absolute http(s) image URL. Null falls back to the homepage favicon
    // when a homepageUrl is set, else a generic glyph. See lib/projectIcon.ts.
    icon: text("icon"),
    // Short human-friendly ID prefix (e.g. "SID"). Derived display data, never
    // an identity anchor — the nanoid PK stays the FK/audit target. Uniqueness
    // is scoped to the owner so `SID-42` is unambiguous within a user's board.
    prefix: text("prefix").notNull(),
    // Monotonic per-project counter for item numbers. Bumped in addItem's
    // transaction and never decremented, so a deleted item's number is never
    // reused (Linear-style). Stored, not derived from MAX(number).
    itemSeq: integer("item_seq").notNull().default(0),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("projects_user_prefix").on(t.userId, t.prefix)],
);

// Collaborators on a project. The owner is projects.userId (always exactly
// one); this table holds the additional editors (zero or more). There is no
// role column — every member has the same read+edit access as the owner,
// except for owner-only actions (delete, prefix change, managing members).
// `status` is the invite lifecycle: a row is `pending` until the target
// accepts, and only `accepted` rows grant access (see hasProjectAccess).
// Cascades on project delete; deliberately NO foreign key on user_id, matching
// projects.user_id / audit_log.actor — a deleted user must not break the
// project for its other members.
export const projectMembers = sqliteTable(
  "project_members",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    status: text("status")
      .$type<MembershipStatus>()
      .notNull()
      .default("pending"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("project_members_project_user").on(t.projectId, t.userId),
    // listPendingInvites filters by (user_id, status) and orders by created_at;
    // this composite serves a user's pending-invite read without scanning the
    // whole table. The unique index above (project-first) can't serve it.
    index("project_members_user_status").on(t.userId, t.status, t.createdAt),
  ],
);

// Per-user ordering of the kanban board. Each viewer (the owner AND every
// accepted member) has one row per project they can see, holding *their* own
// fractional-index position — so reordering a shared project moves it only on
// the board of whoever dragged it. The owner's row is created with the project;
// a member's is created when they accept. Cascades on project delete; a row is
// removed explicitly when a member leaves (no user FK to cascade on).
export const projectPositions = sqliteTable(
  "project_positions",
  {
    userId: text("user_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    position: text("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })],
);

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ItemKind>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    // The user this item is assigned to (the project owner or an accepted
    // member); null = unassigned, the default. Deliberately NO foreign key on
    // user_id, matching projects.user_id / project_members.user_id — a deleted
    // user must not break the item for the rest of the project. Assignment to a
    // non-member is rejected in updateItem, not at the DB layer.
    assigneeId: text("assignee_id"),
    position: text("position").notNull(),
    // Per-project sequence value (from projects.item_seq) behind the display
    // ref `${prefix}-${number}`. Unique within a project; monotonic.
    number: integer("number").notNull(),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("items_project_position").on(t.projectId, t.position),
    uniqueIndex("items_project_number").on(t.projectId, t.number),
  ],
);

// Many-to-many link between items and GitHub pull requests. Explicit, agent-set
// link so a future merge handler can deterministically resolve PR → item(s)
// without fuzzy matching. Cascades on item delete; PR rows are just URLs.
export const itemPrLinks = sqliteTable(
  "item_pr_links",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    prUrl: text("pr_url").notNull(),
    linkedBySource: text("linked_by_source").$type<AuditSource>().notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("item_pr_links_item_pr").on(t.itemId, t.prUrl),
    index("item_pr_links_pr").on(t.prUrl),
  ],
);

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("categories_project_name").on(t.projectId, t.name)],
);

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Append-only change log. Deliberately NO foreign key / cascade to projects
// or users: when a project (or user) is deleted the audit rows must survive
// so the deletion itself stays auditable. `actor` holds the user id of
// whoever performed the action; source/action/entityType are app-validated
// plain TEXT so a new client/action never needs a migration.
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    actor: text("actor").notNull(),
    source: text("source").$type<AuditSource>().notNull(),
    action: text("action").$type<AuditAction>().notNull(),
    entityType: text("entity_type").$type<AuditEntity>().notNull(),
    entityId: text("entity_id").notNull(),
    projectId: text("project_id"),
    detail: text("detail").notNull().default(""),
  },
  (t) => [
    index("audit_log_ts").on(t.ts),
    index("audit_log_project_ts").on(t.projectId, t.ts),
    // listAudit always filters by actor and orders by ts desc; this composite
    // serves the per-user "my activity" read without a full-table scan.
    index("audit_log_actor_ts").on(t.actor, t.ts),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type NewProjectMember = typeof projectMembers.$inferInsert;
export type ProjectPosition = typeof projectPositions.$inferSelect;
export type NewProjectPosition = typeof projectPositions.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type AuditEntry = typeof auditLog.$inferSelect;
export type NewAuditEntry = typeof auditLog.$inferInsert;
export type ItemPrLink = typeof itemPrLinks.$inferSelect;
export type NewItemPrLink = typeof itemPrLinks.$inferInsert;
