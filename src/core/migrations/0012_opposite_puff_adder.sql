PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`summary_updated_at` integer,
	`homepage_url` text,
	`icon` text,
	`prefix` text NOT NULL,
	`item_seq` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "user_id", "name", "status", "summary", "summary_updated_at", "homepage_url", "icon", "prefix", "item_seq", "created_at") SELECT "id", "user_id", "name", CASE "status" WHEN 'paused' THEN 'paused' WHEN 'dormant' THEN 'archived' ELSE 'active' END, "summary", "summary_updated_at", "homepage_url", "icon", "prefix", "item_seq", "created_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_user_prefix` ON `projects` (`user_id`,`prefix`);