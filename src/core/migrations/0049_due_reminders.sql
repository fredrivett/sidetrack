PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`audit_id` text,
	`item_id` text,
	`group_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	`sent_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "user_id", "reason", "audit_id", "item_id", "group_key", "created_at", "read_at", "sent_at") SELECT "id", "user_id", "reason", "audit_id", NULL, "group_key", "created_at", "read_at", "sent_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `notifications_user_created` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_unsent` ON `notifications` (`sent_at`) WHERE "notifications"."sent_at" is null;