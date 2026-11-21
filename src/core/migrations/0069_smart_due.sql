CREATE TABLE `item_smart_matches` (
	`item_id` text NOT NULL,
	`anchor_id` text NOT NULL,
	`reason` text,
	`removed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`item_id`, `anchor_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`anchor_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_smart_matches_anchor` ON `item_smart_matches` (`anchor_id`);--> statement-breakpoint
ALTER TABLE `items` ADD `smart_rule` text;--> statement-breakpoint
ALTER TABLE `items` ADD `smart_lead` integer;