import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { Repeat, RepeatOn, RepeatUnit } from "../lib/repeat";
import type { StoredGreeting } from "./agendaGreeting";
import { apiKeys, users } from "./auth-schema";
import type { ChangeEvent } from "./events";

/** How far a membership limited to someone's items reaches in time, by
 * that person's clock: their today, or their week. */
export const ONLY_WITHIN = ["today", "week"] as const;
export type OnlyWithin = (typeof ONLY_WITHIN)[number];

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
  "cancel",
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
  // The user's address for emailing Sidetrack (emailAddresses).
  "email_address",
  // A comment on an item. Its rows carry the item as parentId, so they show
  // in the item's history.
  "comment",
  // A connected calendar account; entityId is the account id, no project.
  "calendar",
  // A photo of a page whose lines were added (sources); no project.
  "source",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

// A membership starts `pending` (an invite the target hasn't answered) and
// becomes `accepted` once they accept. Only `accepted` rows grant access —
// see hasProjectAccess. Declining/removing deletes the row outright.
export const MEMBERSHIP_STATUSES = ["pending", "accepted"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

// A Space member's role. Admins and members can see and edit every list in
// the Space; admins also manage the Space and its people (see spaces.ts).
// Commenters can see its lists and comment; viewers can only see them.
export const SPACE_ROLES = ["admin", "member", "commenter", "viewer"] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];

// A list member's role (project_members.role): editors can change anything
// a member can; commenters can see the list and comment; viewers can only
// see it. The owner is always an editor, and isn't a member.
export const LIST_ROLES = ["editor", "commenter", "viewer"] as const;
export type ListRole = (typeof LIST_ROLES)[number];

// What someone can do on a list, from least to most (access.ts). Their most
// generous route counts: a list role, a Space role, or owning it.
export const LIST_ACCESS = ["view", "comment", "edit"] as const;
export type ListAccess = (typeof LIST_ACCESS)[number];

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
    // Set when this membership shows only part of the list: the item groups
    // (an item with its sub-items) assigned to this user, usually whoever
    // invited them ("only my tasks"). Null shows everything. Only viewers
    // and commenters are limited; see hasItemAccess in access.ts.
    onlyAssignedTo: text("only_assigned_to"),
    // With onlyAssignedTo, only that person's items in this stretch of their
    // own days: "today" or "week" (Monday to Sunday). Null is every day.
    onlyWithin: text("only_within", { enum: ONLY_WITHIN }),
    // With onlyWithin, whether they also see that person's day note (the
    // words) and mood (its tags, dayTags.ts) on Check-ins. Off unless chosen.
    shareNote: integer("share_note", { mode: "boolean" }).notNull().default(false),
    shareMood: integer("share_mood", { mode: "boolean" }).notNull().default(false),
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
    role: text("role").$type<ListRole>().notNull().default("editor"),
    // Set when this membership shows only part of the list: the item groups
    // (an item with its sub-items) assigned to this user, usually whoever
    // invited them ("only my tasks"). Null shows everything. Only viewers
    // and commenters are limited; see hasItemAccess in access.ts.
    onlyAssignedTo: text("only_assigned_to"),
    // With onlyAssignedTo, only that person's items in this stretch of their
    // own days: "today" or "week" (Monday to Sunday). Null is every day.
    onlyWithin: text("only_within", { enum: ONLY_WITHIN }),
    // With onlyWithin, whether they also see that person's day note (the
    // words) and mood (its tags, dayTags.ts) on Check-ins. Off unless chosen.
    shareNote: integer("share_note", { mode: "boolean" }).notNull().default(false),
    shareMood: integer("share_mood", { mode: "boolean" }).notNull().default(false),
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
    // Who added it: the person, or the person whose API key an agent used.
    // An unassigned item is on its creator's Agenda only (isYours). null for
    // items from before it was kept that had no audit row to fill it from.
    createdBy: text("created_by"),
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
    // The days a weekly or monthly rule keeps to ("on weekends", "on
    // Saturdays"); null for any day, and always for a daily rule.
    repeatOn: text("repeat_on").$type<RepeatOn>(),
    // The day of the month (1 to 31) a monthly rule keeps to ("on the 1st"),
    // whenever it's done; null otherwise, and always alongside repeat_on.
    repeatDay: integer("repeat_day"),
    // A smart due date, in the person's words ("before our next trip"), or
    // null for a date someone set. Its due date is worked out from its
    // matches (item_smart_matches, core/smartDue.ts): the earliest one's
    // start, smart_lead days before. No matches: no date, waiting for one.
    smartRule: text("smart_rule"),
    // Days before the earliest match it's due: 0 on the day. Set with smart_rule.
    smartLead: integer("smart_lead"),
    // When it was closed: ticked off, or cancelled (below). Everything that
    // hides closed items reads this alone; only what counts finished work
    // also checks `cancelled`.
    completedAt: integer("completed_at"),
    // Closed without being done (cancelItem in items.ts), with an optional
    // reason in the person's words and the item that did the work instead.
    // All three are cleared when it reopens.
    cancelled: integer("cancelled", { mode: "boolean" }).notNull().default(false),
    cancelReason: text("cancel_reason"),
    replacedById: text("replaced_by_id").references((): AnySQLiteColumn => items.id, {
      onDelete: "set null",
    }),
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

// The items a smart due date hangs off (items.smart_rule): "Lisbon flights"
// for "before our next trip". `removed` is someone saying it isn't one, which
// keeps it from being matched again. Goes with either item.
export const itemSmartMatches = sqliteTable(
  "item_smart_matches",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    anchorId: text("anchor_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    // Why it fits the rule, in a few words ("a trip"); null when someone
    // picked it themselves.
    reason: text("reason"),
    removed: integer("removed", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.anchorId] }), index("item_smart_matches_anchor").on(t.anchorId)],
);

// The refs an item had in lists it has since moved out of, so `OLD-12` keeps
// resolving to it (resolveItemRef: MCP, PR titles) after it becomes `NEW-4`. Keyed
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

// A user's address for emailing Sidetrack: `<token>@<EMAIL_IN_DOMAIN>`.
// Mail sent or forwarded to it lands in inboundEmails for triage. One per
// user; replacing it makes a new token, and mail to the old one is refused.
// Lowercase letters and digits only, since mail servers may change case.
export const emailAddresses = sqliteTable(
  "email_addresses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at").notNull(),
    // When mail to it last arrived, to help with setup.
    lastReceivedAt: integer("last_received_at"),
  },
  (t) => [
    uniqueIndex("email_addresses_user").on(t.userId),
    uniqueIndex("email_addresses_token").on(t.token),
  ],
);

// Mail received at a user's address, waiting to be triaged against their
// lists. Only the text a triage reads is kept: no HTML or attachments.
// `messageId` is the Message-ID header, so a retried delivery is stored once.
export const inboundEmails = sqliteTable(
  "inbound_emails",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    messageId: text("message_id").notNull(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    // The Date header, when it parses; receivedAt is when Sidetrack got it.
    sentAt: integer("sent_at"),
    receivedAt: integer("received_at").notNull(),
  },
  (t) => [
    uniqueIndex("inbound_emails_message").on(t.userId, t.messageId),
    index("inbound_emails_user_received").on(t.userId, t.receivedAt),
  ],
);

// Something captured to add to Sidetrack: for now, a photo of a handwritten
// page that an agent read. It holds the photo and the lines the agent
// proposed (sourceLines); nothing reaches the board until its owner reviews
// them and adds them. The photo is kept in the DB, like avatars, so the daily
// backup covers it, and stays after review so each item can show where on
// the page it came from. Seen only by its owner.
//
// An agent can't send a photo in a tool call (it would have to write out
// every byte), so the photo arrives separately: the agent proposes the lines,
// gets a one-time upload URL, and PUTs the file to it. Until then `data` is
// null; `uploadTokenHash` is the URL's token, hashed like an API key.
export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").$type<SourceKind>().notNull(),
    contentType: text("content_type"),
    data: blob("data", { mode: "buffer" }),
    uploadTokenHash: text("upload_token_hash"),
    uploadExpiresAt: integer("upload_expires_at"),
    // What the agent wants the reviewer to know, e.g. a line it couldn't read.
    note: text("note"),
    // The API key name of the agent that read it, for the review screen.
    agentName: text("agent_name"),
    createdAt: integer("created_at").notNull(),
    // When every line was added or skipped, or the whole thing discarded.
    reviewedAt: integer("reviewed_at"),
  },
  (t) => [index("sources_user_created").on(t.userId, t.createdAt)],
);

// One line an agent read off a source, proposed as an item. `region` is where
// it sits on the photo, as fractions of its width and height, so the review
// screen and the item can highlight it. A line either adds a new item (in
// `projectId`, under `parentLineId`'s item or `parentItemId`) or stands for an
// item that already exists (`matchItemId`), which it can change or tick off;
// then its fields are the changes proposed, and empty ones leave it be. `itemId` is
// the item it added or matched once added.
export const sourceLines = sqliteTable(
  "source_lines",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    title: text("title").notNull(),
    projectId: text("project_id").notNull(),
    parentLineId: text("parent_line_id"),
    parentItemId: text("parent_item_id"),
    matchItemId: text("match_item_id"),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
    dueDate: text("due_date"),
    labels: text("labels", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    repeat: text("repeat", { mode: "json" }).$type<Repeat>(),
    assigneeIds: text("assignee_ids", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    region: text("region", { mode: "json" }).$type<SourceRegion>(),
    status: text("status").$type<SourceLineStatus>().notNull().default("pending"),
    itemId: text("item_id"),
  },
  (t) => [
    index("source_lines_source").on(t.sourceId, t.ord),
    index("source_lines_item").on(t.itemId),
  ],
);

export const SOURCE_KINDS = ["photo"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_LINE_STATUSES = ["pending", "added", "skipped"] as const;
export type SourceLineStatus = (typeof SOURCE_LINE_STATUSES)[number];
/**
 * Where a line sits on its photo: its box before turning, each a fraction (0
 * to 1) of the photo's size, and `angle`, the degrees it's turned clockwise
 * about its centre, for a line written on a slant.
 */
export type SourceRegion = { x: number; y: number; w: number; h: number; angle?: number };

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

export const CALENDAR_KINDS = ["icloud"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

// A calendar account someone connected (core/calendars.ts), such as their
// iCloud over CalDAV. Its calendars and their events are theirs alone, never
// shown to list-mates. `secret` is the app-specific password, sealed with
// CALENDAR_SECRET_KEY (lib/secretBox.ts) for this row's id: never shown
// back, logged or audited.
export const calendarAccounts = sqliteTable(
  "calendar_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<CalendarKind>().notNull(),
    // The sign-in name, such as an Apple ID email.
    username: text("username").notNull(),
    secret: text("secret").notNull(),
    // The collection holding the account's calendars, found when connecting.
    homeUrl: text("home_url").notNull(),
    createdAt: integer("created_at").notNull(),
    lastSyncedAt: integer("last_synced_at"),
    // Why the last sync failed, in words for settings; null when it worked.
    lastError: text("last_error"),
    // The server refused the password (revoked, say): sync stops until they reconnect.
    needsReconnect: integer("needs_reconnect", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("calendar_accounts_user").on(t.userId)],
);

// One calendar on an account, as its server lists it. Sync keeps the name,
// colour and ctag up to date without auditing them (they're the server's,
// not a change anyone made here); including or leaving one out is audited.
export const calendars = sqliteTable(
  "calendars",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: "cascade" }),
    remoteUrl: text("remote_url").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    included: integer("included", { mode: "boolean" }).notNull().default(true),
    // The ctag its events were last fetched at, and when: they're fetched
    // again when it changes, and every 6 hours anyway as the window moves on.
    ctag: text("ctag"),
    eventsFetchedAt: integer("events_fetched_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("calendars_account_url").on(t.accountId, t.remoteUrl)],
);

// A copy of each included calendar's events from yesterday to a fortnight
// ahead, one row per occurrence, rebuilt by sync whenever the calendar
// changes. A cache of the owner's own data, so not audited.
export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    uid: text("uid").notNull(),
    // The repeat's original start, for a recurring event; "" otherwise.
    recurrenceId: text("recurrence_id").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    // ms. For an all-day event, midnight UTC of its first day and of the day after its last.
    start: integer("start").notNull(),
    end: integer("end").notNull(),
    allDay: integer("all_day", { mode: "boolean" }).notNull(),
    // An all-day event's first and last day, YYYY-MM-DD.
    startDay: text("start_day"),
    endDay: text("end_day"),
    tentative: integer("tentative", { mode: "boolean" }).notNull(),
  },
  (t) => [index("calendar_events_calendar_start").on(t.calendarId, t.start)],
);

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
    // When it was archived: it stays on the items that have it, but isn't
    // offered for new ones. null = in use.
    archivedAt: integer("archived_at"),
  },
  (t) => [uniqueIndex("labels_project_name").on(t.projectId, t.name)],
);

// A device a user turned push notifications on for: the browser's Web Push
// subscription, which is where and how to send it a notification
// (lib/push.ts). One row per endpoint, which is unique to the browser
// install, so turning it on again on the same device replaces the row.
// Delivery state, like sessions, so it isn't audited. No foreign key on
// user_id, matching projects.user_id.
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id").notNull(),
    // The subscription's keys (base64url), which encrypt what's sent to it.
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    // The server's VAPID public key the browser subscribed with. A
    // subscription only takes pushes signed with its own key, so one made
    // before the keys changed is dead until the device turns push on again.
    vapidKey: text("vapid_key").notNull(),
    // What the device said it was when it subscribed ("iPhone"), to tell
    // devices apart in Settings.
    deviceLabel: text("device_label").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("push_subscriptions_user").on(t.userId)],
);

// Why a change concerns its recipient (core/notifications.ts), strongest
// first: a change that concerns someone for two reasons tells them once,
// for the first.
export const NOTIFICATION_REASONS = [
  // Direct: aimed at the recipient.
  "assigned",
  "mentioned",
  "invited",
  "agent-finished",
  // Something of theirs is due today, or was due yesterday (core/reminders.ts).
  "due-today",
  "overdue",
  // Involved: something they're part of moved.
  "unassigned",
  "following",
  "joined",
  "role",
  // A list or Space they're in was archived, restored or deleted.
  "member",
  // Ambient: other activity on a list or Space they're in.
  "activity",
] as const;
export type NotificationReason = (typeof NOTIFICATION_REASONS)[number];

// How much someone hears about a list or Space: "all" pushes everything,
// "default" pushes what's aimed at them or what they follow (the rest goes to
// the inbox only), and "mine" keeps only what's aimed at them.
export const NOTIFICATION_LEVELS = ["all", "default", "mine"] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

// Someone's notification level for a scope: "all" for everything,
// "space:<id>" or "list:<id>". The most specific one set wins; with none,
// "default". Due reminders have a scope of their own, "reminders", where
// "all" pushes them (with none set, too), "default" keeps them to the inbox
// and "mine" turns them off. What isn't a person's doing (other people's
// agents, GitHub, Sidetrack itself) has one too, "agents": "all" hears it
// like people's, "default" (also with none set) keeps it to the inbox and
// "mine" keeps only what's aimed at them. Per person and seen by nobody else, so not
// audited, like following an item.
export const notificationSettings = sqliteTable(
  "notification_settings",
  {
    userId: text("user_id").notNull(),
    scope: text("scope").notNull(),
    level: text("level").$type<NotificationLevel>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.scope] })],
);

// A user's inbox: one row per person a change concerns, written by
// recordAudit in the change's transaction, so a change that rolls back
// notifies nobody. It holds who and why, not words: the inbox and the push
// read the change's event and describe it when they show it, with current
// names. Derived from the audit row, so not audited itself, and no foreign
// keys, like audit_log.
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    reason: text("reason").$type<NotificationReason>().notNull(),
    // The change it's about; null for a due reminder, which is about itemId.
    auditId: text("audit_id"),
    itemId: text("item_id"),
    // What it's about, to replace an older push about the same thing: an
    // item, or a list or Space for an invite.
    groupKey: text("group_key").notNull(),
    createdAt: integer("created_at").notNull(),
    readAt: integer("read_at"),
    // When the sender claimed it (null: not yet). Set whether or not a push
    // went out: without VAPID keys, when too old to push, or when the push
    // failed. It's never retried.
    sentAt: integer("sent_at"),
  },
  (t) => [
    index("notifications_user_created").on(t.userId, t.createdAt),
    // Only pending rows are ever looked up by it.
    index("notifications_unsent").on(t.sentAt).where(sql`${t.sentAt} is null`),
  ],
);

// Who follows an item, to hear its activity (core/follows.ts). People
// follow automatically when they create it, are assigned, comment or are
// mentioned; `following` false is someone's choice to unfollow, which those
// don't undo. Following a parent covers its sub-items. Per person, and seen
// by nobody else, so not audited, like a list's position.
export const itemFollows = sqliteTable(
  "item_follows",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    following: integer("following", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.userId] }), index("item_follows_user").on(t.userId)],
);

// The Agenda greeting Claude last wrote for each person (agendaGreeting.ts),
// so a reload with nothing new reads it back instead of asking again, and
// when and how often they've been asked today, so nobody can run up the
// bill. Per person and seen by nobody else, so not audited.
export const agendaGreetings = sqliteTable("agenda_greetings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // The viewer's day and part of it ("2026-11-19:morning") it was written for.
  key: text("key").notNull(),
  // Null until a write succeeds for `key`.
  // Claude's greeting, or a failed ask's trace with no text; null while asking.
  greeting: text("greeting", { mode: "json" }).$type<StoredGreeting>(),
  askedAt: integer("asked_at").notNull(),
  // The UTC day the asks were counted on, and how many.
  askedDay: text("asked_day").notNull(),
  asks: integer("asks").notNull(),
  // How many asks in a row came close together, which sets how long the next one waits.
  streak: integer("streak").notNull().default(0),
});

// What someone wrote about their day, such as "not feeling well" or "keen
// to get through a lot" (dayNotes.ts), one per person per day (4am
// turnover), which the Agenda greeting is written with. Per person and
// seen by nobody else, so not audited, like greeting prefs.
export const dayNotes = sqliteTable(
  "day_notes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // YYYY-MM-DD, the writer's day.
    day: text("day").notNull(),
    text: text("text").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
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
    // What happened, as free text, on rows from before change events.
    // Nothing writes it now: an event row leaves it empty and is read back
    // through core/describe.ts.
    detail: text("detail").notNull().default(""),
    // What happened, as data (core/events.ts): ids, plus whatever a rename
    // or delete could make unreadable. Null on free-text rows.
    event: text("event", { mode: "json" }).$type<ChangeEvent>(),
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
export type Source = typeof sources.$inferSelect;
export type SourceLine = typeof sourceLines.$inferSelect;
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
