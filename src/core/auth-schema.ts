import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Better Auth core tables. Field names match Better Auth's expected shape
// (camelCase props, snake_case columns) so the drizzle adapter can map them
// without per-field overrides. Adapter is configured with `usePlural: true`
// — that's why these tables are plural to match the rest of the app schema.

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  // Better Auth `username` plugin fields. `username` is the normalized
  // (lowercased) handle used for lookups and uniqueness; `displayUsername`
  // preserves the original casing for display. Both are NOT NULL: every user
  // is required to pick a handle at sign-up (the plugin injects it into the
  // create before the row is inserted), and the migration backfills existing
  // users from their email. The unique index gives case-insensitive
  // uniqueness for free since `username` is already normalized.
  username: text("username").notNull().unique(),
  displayUsername: text("display_username").notNull(),
  // IANA timezone ("Europe/London") last reported by the user's browser, so
  // agents work out "today" the way the user's own screen does. null until
  // they first open the app.
  timeZone: text("time_zone"),
  // Whether the Agenda's Overdue section is folded away, on every device.
  overdueCollapsed: integer("overdue_collapsed", { mode: "boolean" })
    .notNull()
    .default(false),
  // Where the Personal tray (their lists in no Space) sits among their Spaces
  // on the board, as a fractional index beside space_members.position. null,
  // showing it first, until their trays are placed (see placeTrays in
  // spaces.ts).
  personalTrayPosition: text("personal_tray_position"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp_ms",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp_ms",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Hand-rolled API keys table. Better Auth 1.6 has no apiKey plugin; building
// our own is ~30 lines and keeps the existing `?key=...` URL flow that
// claude.ai connectors require (they can't set custom request headers).
//
// Storage model: only the sha256 of the full key is persisted; the prefix
// (first 8 chars) is stored separately for UI display ("sk_abcdefgh…"). On
// revocation, rows are deleted outright — revoked keys don't need to linger.
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("api_keys_key_hash").on(t.keyHash),
    // listApiKeys filters by user_id and orders by created_at desc; this
    // composite serves the per-user key listing without a full-table scan.
    index("api_keys_user_created").on(t.userId, t.createdAt),
  ],
);

// An avatar image the user uploaded (Profile), served at its own route since
// users.image only holds a URL. A separate table, not a users column, so the
// bytes aren't read with every session lookup. In the DB rather than on disk
// so the daily SQLite backup covers it. One per user; replacing overwrites.
export const avatars = sqliteTable("avatars", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Verification = typeof verifications.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
