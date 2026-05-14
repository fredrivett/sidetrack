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

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().default("me"),
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
    category: text("category"),
    position: text("position").notNull(),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("items_project_position").on(t.projectId, t.position)],
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

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
