-- Add the Better Auth `username` plugin fields (`username`, `display_username`)
-- to `users` as NOT NULL. drizzle-kit's default output is a bare
-- `ALTER TABLE ... ADD ... NOT NULL`, which fails on a populated table and
-- leaves existing users without a handle. Instead we do the standard SQLite
-- table-rebuild so the columns land NOT NULL *and* every existing row is
-- backfilled in the same statement.
--
-- Backfill rule: derive a handle from the email local-part (the bit before
-- `@`), lowercased, with `+`/`-` stripped (kept out so handles never collide
-- with item-ref separators), padded to the 3-char minimum, and de-duplicated
-- by suffixing a number on collision. These are deterministic defaults;
-- users can rename in settings. Go-forward sign-ups are validated/normalized
-- by the plugin itself, so this SQL is one-time only.
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
WITH `derived` AS (
	SELECT
		`id`, `name`, `email`, `email_verified`, `image`, `created_at`, `updated_at`,
		CASE WHEN length(`cleaned`) >= 3 THEN `cleaned` ELSE substr(`cleaned` || '000', 1, 3) END AS `base`
	FROM (
		SELECT *,
			replace(replace(lower(substr(`email`, 1, instr(`email`, '@') - 1)), '+', ''), '-', '') AS `cleaned`
		FROM `users`
	)
),
`numbered` AS (
	SELECT *, ROW_NUMBER() OVER (PARTITION BY `base` ORDER BY `created_at`, `id`) AS `rn`
	FROM `derived`
)
INSERT INTO `__new_users` (`id`, `name`, `email`, `email_verified`, `image`, `username`, `display_username`, `created_at`, `updated_at`)
SELECT
	`id`, `name`, `email`, `email_verified`, `image`,
	`base` || CASE WHEN `rn` = 1 THEN '' ELSE CAST(`rn` AS TEXT) END,
	`base` || CASE WHEN `rn` = 1 THEN '' ELSE CAST(`rn` AS TEXT) END,
	`created_at`, `updated_at`
FROM `numbered`;
--> statement-breakpoint
DROP TABLE `users`;
--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
