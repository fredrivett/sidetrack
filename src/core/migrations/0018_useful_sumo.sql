CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_key_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`thread_url` text,
	`branch` text NOT NULL,
	`note` text,
	`started_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_item` ON `agent_sessions` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_sessions_open_item_agent` ON `agent_sessions` (`item_id`,`agent_key_id`) WHERE "agent_sessions"."finished_at" is null;