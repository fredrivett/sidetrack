CREATE TABLE `item_pr_links` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`pr_url` text NOT NULL,
	`linked_by_source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_pr_links_item_pr` ON `item_pr_links` (`item_id`,`pr_url`);--> statement-breakpoint
CREATE INDEX `item_pr_links_pr` ON `item_pr_links` (`pr_url`);