CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`audit_id` text NOT NULL,
	`group_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	`sent_at` integer
);
--> statement-breakpoint
CREATE INDEX `notifications_user_created` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_unsent` ON `notifications` (`sent_at`);