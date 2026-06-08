-- Add the Better Auth `username` plugin fields (`username`, `display_username`)
-- to `users` as NOT NULL. drizzle-kit's default output is a bare
-- `ALTER TABLE ... ADD ... NOT NULL`, which fails on a populated table, so we
-- do the standard SQLite table-rebuild instead.
--
-- Existing rows are backfilled with a *placeholder* (`!` + id): guaranteed
-- unique (id is the PK) and impossible to mistake for a real handle (`!` is
-- outside the allowed charset). This lets the columns land NOT NULL + unique
-- immediately; the real, human-friendly handles are derived in TS right after
-- migration by backfillUsernames() — where de-duplication is trivially correct
-- (a pure-SQL suffix scheme could emit a suffixed handle that collides with a
-- different base, e.g. `bob`+2 vs an existing `bob2`).
--
-- FK enforcement is OFF during migrations (see runMigrations in migrate.ts),
-- so DROP TABLE `users` does not cascade into sessions/accounts/api_keys; the
-- post-migration foreign_key_check verifies nothing dangled.
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`username` text NOT NULL,
	`display_username` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users` (`id`, `name`, `email`, `email_verified`, `image`, `username`, `display_username`, `created_at`, `updated_at`)
SELECT `id`, `name`, `email`, `email_verified`, `image`, '!' || `id`, '!' || `id`, `created_at`, `updated_at`
FROM `users`;
--> statement-breakpoint
DROP TABLE `users`;
--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
