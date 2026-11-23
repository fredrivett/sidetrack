CREATE TABLE `day_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`sharer_id` text NOT NULL,
	`viewer_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`within` text NOT NULL,
	`share_note` integer DEFAULT false NOT NULL,
	`share_mood` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sharer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`viewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `day_shares_sharer_viewer` ON `day_shares` (`sharer_id`,`viewer_id`);--> statement-breakpoint
CREATE INDEX `day_shares_viewer` ON `day_shares` (`viewer_id`,`status`);