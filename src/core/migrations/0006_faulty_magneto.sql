-- Item short IDs: per-project `prefix` + monotonic `number` => display ref like
-- `SID-42`. drizzle-kit's default output is bare `ALTER TABLE ... ADD ... NOT
-- NULL`, which fails on a populated table and backfills nothing, so we do the
-- standard SQLite table-rebuild instead.
--
-- `projects.prefix` lands as a *placeholder* (`!` + id): guaranteed unique per
-- owner (id is the global PK) and impossible to mistake for a real prefix (`!`
-- is outside the letters-only charset). The real, de-duplicated handles are
-- derived in TS right after migration by backfillItemPrefixes() — where Set-
-- based dedup per owner is trivially correct, mirroring the username backfill.
-- `projects.item_seq` is seeded to each project's current item count (== the
-- highest number assigned below), keeping the counter monotonic going forward.
--
-- `items.number` is assigned per project by creation order via row_number(),
-- which better-sqlite3's bundled SQLite supports.
--
-- FK enforcement is OFF during migrations (see runMigrations in migrate.ts), so
-- dropping projects/items does not cascade into items/categories/pr_links; the
-- post-migration foreign_key_check verifies nothing dangled.
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'idea' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`summary_updated_at` integer,
	`position` text NOT NULL,
	`prefix` text NOT NULL,
	`item_seq` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_projects` (`id`, `user_id`, `name`, `status`, `summary`, `summary_updated_at`, `position`, `prefix`, `item_seq`, `created_at`)
SELECT `id`, `user_id`, `name`, `status`, `summary`, `summary_updated_at`, `position`,
	'!' || `id`,
	(SELECT count(*) FROM `items` WHERE `items`.`project_id` = `projects`.`id`),
	`created_at`
FROM `projects`;
--> statement-breakpoint
DROP TABLE `projects`;
--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_user_prefix` ON `projects` (`user_id`,`prefix`);
--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text,
	`position` text NOT NULL,
	`number` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_items` (`id`, `project_id`, `kind`, `title`, `description`, `category`, `position`, `number`, `completed_at`, `created_at`)
SELECT `id`, `project_id`, `kind`, `title`, `description`, `category`, `position`,
	row_number() OVER (PARTITION BY `project_id` ORDER BY `created_at`, `id`),
	`completed_at`, `created_at`
FROM `items`;
--> statement-breakpoint
DROP TABLE `items`;
--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;
--> statement-breakpoint
CREATE INDEX `items_project_position` ON `items` (`project_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_project_number` ON `items` (`project_id`,`number`);
