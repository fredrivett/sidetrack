-- Adds agent_sessions.branch by rebuilding the table rather than ALTER TABLE
-- ADD COLUMN: a database that ran an earlier, since-replaced 0018 already has
-- the column, and SQLite has no ADD COLUMN IF NOT EXISTS. Copying every other
-- column works from either state; nothing references agent_sessions.
CREATE TABLE `__new_agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_key_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`thread_url` text,
	`note` text,
	`started_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	`finished_at` integer,
	`branch` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_sessions` (`id`, `item_id`, `user_id`, `agent_key_id`, `agent_name`, `thread_url`, `note`, `started_at`, `last_active_at`, `finished_at`) SELECT `id`, `item_id`, `user_id`, `agent_key_id`, `agent_name`, `thread_url`, `note`, `started_at`, `last_active_at`, `finished_at` FROM `agent_sessions`;
--> statement-breakpoint
DROP TABLE `agent_sessions`;
--> statement-breakpoint
ALTER TABLE `__new_agent_sessions` RENAME TO `agent_sessions`;
--> statement-breakpoint
CREATE INDEX `agent_sessions_item` ON `agent_sessions` (`item_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_sessions_open_item_agent` ON `agent_sessions` (`item_id`,`agent_key_id`) WHERE "agent_sessions"."finished_at" is null;
