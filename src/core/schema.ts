import { sql } from "drizzle-orm";
import {
  index,
  integer,
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
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<ProjectStatus>().notNull().default("idea"),
  summary: text("summary").notNull().default(""),
  summaryUpdatedAt: integer("summary_updated_at"),
  position: text("position").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

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
    position: text("position").notNull(),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("items_project_position").on(t.projectId, t.position)],
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
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type AuditEntry = typeof auditLog.$inferSelect;
export type NewAuditEntry = typeof auditLog.$inferInsert;
export type ItemPrLink = typeof itemPrLinks.$inferSelect;
export type NewItemPrLink = typeof itemPrLinks.$inferInsert;
