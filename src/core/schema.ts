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
import { apiKeys } from "./auth-schema";

// A list's lifecycle (a "project" in code; "list" to people and agents).
// active lists are on the board; archived lists leave it, and every other
// view, for the Archived view, keeping their items until they're restored.
export const PROJECT_STATUSES = ["active", "archived"] as const;
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
  // Older audit rows; labels replaced categories (see labels below).
  "category",
  "label",
  "api_key",
  "member",
  "space",
  "space_member",
  // The user's own profile (avatar). entityId is the user id; no project.
  "profile",
  "webhook",
  // A comment on an item. Its rows carry the item as parentId, so they show
  // in the item's history.
  "comment",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

// A membership starts `pending` (an invite the target hasn't answered) and
// becomes `accepted` once they accept. Only `accepted` rows grant access —
// see hasProjectAccess. Declining/removing deletes the row outright.
export const MEMBERSHIP_STATUSES = ["pending", "accepted"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

// A Space member's role. Every accepted member can see and edit every list in
// the Space; admins also manage the Space and its people (see spaces.ts).
export const SPACE_ROLES = ["admin", "member"] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];

// A Space's colour, which tints its tray on the board. Each name is a
// --color-space-* token in globals.css, all in the same soft tone. null = grey.
export const SPACE_COLORS = [
  "rose",
  "clay",
  "sand",
  "olive",
  "sage",
  "lagoon",
  "slate",
  "dusk",
  "plum",
  "stone",
] as const;
export type SpaceColor = (typeof SPACE_COLORS)[number];

// A group of people who share every list in it (a household, a team). A list
// is in one Space or none (projects.spaceId). createdBy is only a record: the
// creator's access and admin role come from their space_members row, like
// everyone else's. No foreign key on it, like projects.user_id.
export const spaces = sqliteTable("spaces", {
  id: text("id").primaryKey(),
  createdBy: text("created_by").notNull(),
  name: text("name").notNull(),
  // Emoji or http(s) image URL, as projects.icon; null = generic glyph.
  icon: text("icon"),
  color: text("color").$type<SpaceColor>(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// People in a Space, mirroring project_members: `pending` until the invitee
// accepts, and only `accepted` rows grant access to the Space's lists (see
// hasProjectAccess). Cascades on Space delete; no foreign key on user_id.
export const spaceMembers = sqliteTable(
  "space_members",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    status: text("status")
      .$type<MembershipStatus>()
      .notNull()
      .default("pending"),
    role: text("role").$type<SpaceRole>().notNull().default("member"),
    // Where the Space sits among this member's own trays on their board, as a
    // fractional index, so reordering moves it only for whoever did it. Set
    // to the end when they create or join it. Null for memberships from
    // before trays could move, until placed (see placeTrays in spaces.ts);
    // those sort last, oldest Space first.
    position: text("position"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("space_members_space_user").on(t.spaceId, t.userId),
    index("space_members_user_status").on(t.userId, t.status, t.createdAt),
  ],
);

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
    // The GitHub repository the list's code lives in, as "owner/repo"
    // (normalizeRepository), so an agent started on one of its items knows
    // what to check out. Only the list's admin sets it (isListAdmin), since it
    // decides where agents work. null = none: nobody can start an agent on
    // its items from Sidetrack, though an agent can still start_work itself.
    repository: text("repository"),
    // Optional project icon: either an emoji grapheme (e.g. "🚀") or an
    // absolute http(s) image URL. Null falls back to the homepage favicon
    // when a homepageUrl is set, else a generic glyph. See lib/projectIcon.ts.
    icon: text("icon"),
    // Whether someone chose the icon, including choosing none. A chosen icon
    // always stays. Otherwise it's Jev's suggestion for the list's name,
    // summary and homepage, shown faded while editing and replaced as they
    // change.
    iconChosen: integer("icon_chosen", { mode: "boolean" }).notNull().default(false),
    // Short human-friendly ID prefix (e.g. "SID"). Derived display data, never
    // an identity anchor — the nanoid PK stays the FK/audit target. Uniqueness
    // is scoped to the owner so `SID-42` is unambiguous within a user's board.
    prefix: text("prefix").notNull(),
    // Monotonic per-project counter for item numbers. Bumped in addItem's
    // transaction and never decremented, so a deleted item's number is never
    // reused (Linear-style). Stored, not derived from MAX(number).
    itemSeq: integer("item_seq").notNull().default(0),
    // The Space this list is in, shared with everyone in it; null = none.
    // Deleting a Space returns its lists to their owners, never deletes them.
    spaceId: text("space_id").references(() => spaces.id, { onDelete: "set null" }),
    // When someone last moved the list's done items into Done ahead of the
    // day turning over (see ProjectColumn); items finished before it leave
    // the list for Done. Null = never.
    doneClearedAt: integer("done_cleared_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("projects_user_prefix").on(t.userId, t.prefix),
    index("projects_space").on(t.spaceId),
  ],
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
    // The item's labels, by name, as a JSON array with no duplicates; [] =
    // none. Each names a row in `labels` for the same project, which holds
    // its emoji; renaming a label rewrites it here (see core/labels.ts).
    labels: text("labels", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
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
    // A parent whose sub-items are folded away on the board. Kept on the item,
    // so it's the same for everyone who sees the list and survives a reload.
    collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
    // Per-project sequence value (from projects.item_seq) behind the display
    // ref `${prefix}-${number}`. Unique within a project; monotonic.
    number: integer("number").notNull(),
    // The calendar day it's due, as "YYYY-MM-DD", with no time or timezone:
    // "due Saturday" means Saturday wherever you are. null = no date.
    dueDate: text("due_date"),
    // For a span such as "this week", its first day ("YYYY-MM-DD"), before
    // due_date, its last; the item is due any day from one to the other.
    // null = due on due_date alone.
    dueFrom: text("due_from"),
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

// The refs an item had in lists it has since moved out of, so `OLD-12` keeps
// resolving to it (MCP, PR titles, search) after it becomes `NEW-4`. Keyed
// like items' own refs, by list and number; that list's counter never reuses
// the number, so an alias can't clash with an item still there. Goes with
// either the old list or the item.
export const itemRefAliases = sqliteTable(
  "item_ref_aliases",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.number] }),
    index("item_ref_aliases_item").on(t.itemId),
  ],
);

// A GitHub pull request's state as the webhook last reported it.
export const PR_STATES = ["open", "draft", "merged", "closed"] as const;
export type PrState = (typeof PR_STATES)[number];

// Many-to-many link between items and GitHub pull requests. Explicit, agent-set
// link so a future merge handler can deterministically resolve PR → item(s)
// without fuzzy matching. Cascades on item delete; PR rows are just URLs.
// prState mirrors the PR on GitHub, kept by the owner's webhook; null until a
// delivery reports it (no webhook, or linked before one arrived).
export const itemPrLinks = sqliteTable(
  "item_pr_links",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    prUrl: text("pr_url").notNull(),
    linkedBySource: text("linked_by_source").$type<AuditSource>().notNull(),
    prState: text("pr_state").$type<PrState>(),
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
    // The git branch start_work told the agent to use, kept as given so
    // renaming the item later doesn't change it. The default only fills rows
    // from before the column existed; startWork always sets it.
    branch: text("branch").notNull().default(""),
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

// A comment on an item. userId is its author: the person who
// wrote it, or for an agent's comment the person the agent works for, with the
// agent's API key and a snapshot of its name, as on agent_sessions. No foreign
// key on user_id or the key, so a deleted user or revoked key keeps its
// comments. Cascades on item delete: deleting the item is the logged event.
/** Longest comment, in characters. */
export const COMMENT_MAX = 10_000;

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    agentKeyId: text("agent_key_id"),
    agentName: text("agent_name"),
    // Markdown, as item descriptions.
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
    // When its author last edited it; null if they never have.
    editedAt: integer("edited_at"),
  },
  (t) => [
    index("comments_item_created").on(t.itemId, t.createdAt),
    // Activity's Comments tab reads the newest across lists.
    index("comments_created").on(t.createdAt),
  ],
);

// A user's GitHub webhook: the id goes in the payload URL GitHub posts to
// (/api/github/webhook/<id>) and picks whose board the PR titles' refs resolve
// against. One per user. No foreign key on user_id, matching projects.user_id.
export const githubWebhooks = sqliteTable(
  "github_webhooks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("github_webhooks_user").on(t.userId)],
);

// The secrets a webhook accepts, each named by the user (say, for the
// repository it's pasted into): a delivery signed with any of them verifies
// GitHub's X-Hub-Signature-256. Several let repositories have their own, and a
// secret be rotated without breaking the rest. Stored as is, not hashed,
// because checking a signature needs it.
export const githubWebhookSecrets = sqliteTable(
  "github_webhook_secrets",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => githubWebhooks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    secret: text("secret").notNull(),
    createdAt: integer("created_at").notNull(),
    // When a delivery signed with this secret last arrived, to help with setup.
    lastDeliveryAt: integer("last_delivery_at"),
  },
  (t) => [index("github_webhook_secrets_webhook").on(t.webhookId)],
);

// An API key whose agent Sidetrack can start: assigning the agent to an item
// posts to `url` (say, an Amp plugin's webhook), signed with `secret` so the
// receiver knows the request came from here. One per key, gone with the key.
// Both are credentials: settings never shows the URL back, and the secret is
// handed out once, when it's made. Stored as is, since signing needs it.
export const agentWebhooks = sqliteTable("agent_webhooks", {
  keyId: text("key_id")
    .primaryKey()
    .references(() => apiKeys.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  createdAt: integer("created_at").notNull(),
});

// A list's labels. Items carry them by name (items.labels). The emoji is
// optional and works like projects.icon: emojiChosen says whether someone
// chose it (or chose none), and otherwise it's Jev's suggestion for the name.
export const labels = sqliteTable(
  "labels",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emoji: text("emoji"),
    emojiChosen: integer("emoji_chosen", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("labels_project_name").on(t.projectId, t.name)],
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
    // For an item's row, the item it was a sub-item of at the time, so the
    // parent's history keeps its sub-items' rows after they're deleted or
    // moved out; for a comment's row, the item it's on. No FK, like
    // project_id: the parent may be deleted too.
    parentId: text("parent_id"),
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
    // An item's history (listAudit with itemId) reads its own rows by entity
    // and its sub-items' by parent, newest first.
    index("audit_log_entity_ts").on(t.entityId, t.ts),
    index("audit_log_parent_ts").on(t.parentId, t.ts),
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
export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;
export type AuditEntry = typeof auditLog.$inferSelect;
export type NewAuditEntry = typeof auditLog.$inferInsert;
export type ItemPrLink = typeof itemPrLinks.$inferSelect;
export type NewItemPrLink = typeof itemPrLinks.$inferInsert;
export type AgentSession = typeof agentSessions.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type GithubWebhook = typeof githubWebhooks.$inferSelect;
