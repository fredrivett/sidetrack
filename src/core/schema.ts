import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { RepeatUnit } from "../lib/repeat";

// A list's lifecycle (a "project" in code; "list" to people and agents).
// active lists are on the board; paused lists sit collapsed at its end;
// archived lists leave the board but keep their items and can be restored.
export const PROJECT_STATUSES = ["active", "paused", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// `system` is a change nobody made, such as a repeating item reopening on its
// next due date.
export const AUDIT_SOURCES = ["web", "mcp", "github", "system"] as const;
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
  // An agent's work session on an item: start_work, report_work, finish_work.
  "start",
  "report",
  "finish",
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
    status: text("status").$type<ProjectStatus>().notNull().default("active"),
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
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    // The users this item is assigned to (the project owner and/or accepted
    // members), as a JSON array of user ids with no duplicates; [] =
    // unassigned, the default. Joint items ("both of us") hold several. A JSON
    // column rather than a join table so every read of an item carries its
    // assignees. Deliberately no foreign key to users, matching
    // projects.user_id / project_members.user_id / audit_log.actor, so a
    // deleted user can't break a project's rows. Assignment is kept honest at
    // the app layer instead: updateItem rejects assigning a non-member, and
    // removeMember takes a departing member off every item here.
    assigneeIds: text("assignee_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    // Checklists: a sub-item points at its parent, one level deep (a parent
    // has no parent of its own). Positions are scoped to the parent, so a
    // sub-item's position only orders it among its siblings.
    parentId: text("parent_id").references((): AnySQLiteColumn => items.id, {
      onDelete: "cascade",
    }),
    position: text("position").notNull(),
    // Per-project sequence value (from projects.item_seq) behind the display
    // ref `${prefix}-${number}`. Unique within a project; monotonic.
    number: integer("number").notNull(),
    // The calendar day it's due, as "YYYY-MM-DD", with no time or timezone:
    // "due Saturday" means Saturday wherever you are. null = no date.
    dueDate: text("due_date"),
    // Repeat rule ("every 3 days"): both set, or both null for an item that
    // doesn't repeat. A finished repeating item reopens on the day this long
    // after the day it was done (reopenDueRepeats in items.ts).
    repeatEvery: integer("repeat_every"),
    repeatUnit: text("repeat_unit").$type<RepeatUnit>(),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("items_project_position").on(t.projectId, t.position),
    index("items_parent").on(t.parentId),
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

// An agent working on an item, from start_work until finish_work (or the item
// being completed). The agent is the API key it called with: agentKeyId plus a
// snapshot of the key's name ("Amp"), like audit_log, so the session still says
// who worked on it after the key is revoked; no foreign key to api_keys for
// the same reason. userId is the key's owner, the person it works for.
// lastActiveAt moves on every start/report, so the board can tell a working
// agent from one that has gone quiet. One open session per agent per item.
export const agentSessions = sqliteTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    agentKeyId: text("agent_key_id").notNull(),
    agentName: text("agent_name").notNull(),
    // The agent's own thread or session page, an absolute http(s) URL.
    threadUrl: text("thread_url"),
    // The latest progress note from report_work ("Opened the PR").
    note: text("note"),
    startedAt: integer("started_at").notNull(),
    lastActiveAt: integer("last_active_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (t) => [
    index("agent_sessions_item").on(t.itemId),
    uniqueIndex("agent_sessions_open_item_agent")
      .on(t.itemId, t.agentKeyId)
      .where(sql`${t.finishedAt} is null`),
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
    // The API key an agent (MCP) call came through, and that key's name at the
    // time ("Claude desktop"). Null for web and other non-agent changes. The
    // name is a snapshot, not a join: revoking a key deletes its row, and the
    // history must still say which agent made the change.
    agentKeyId: text("agent_key_id"),
    agentName: text("agent_name"),
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
export type AgentSession = typeof agentSessions.$inferSelect;
