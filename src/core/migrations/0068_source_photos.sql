CREATE TABLE `source_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`ord` integer NOT NULL,
	`title` text NOT NULL,
	`project_id` text NOT NULL,
	`parent_line_id` text,
	`parent_item_id` text,
	`match_item_id` text,
	`done` integer DEFAULT false NOT NULL,
	`due_date` text,
	`labels` text DEFAULT '[]' NOT NULL,
	`repeat` text,
	`assignee_ids` text DEFAULT '[]' NOT NULL,
	`region` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`item_id` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_lines_source` ON `source_lines` (`source_id`,`ord`);--> statement-breakpoint
CREATE INDEX `source_lines_item` ON `source_lines` (`item_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`content_type` text,
	`data` blob,
	`upload_token_hash` text,
	`upload_expires_at` integer,
	`note` text,
	`agent_name` text,
	`created_at` integer NOT NULL,
	`reviewed_at` integer
);
--> statement-breakpoint
CREATE INDEX `sources_user_created` ON `sources` (`user_id`,`created_at`);