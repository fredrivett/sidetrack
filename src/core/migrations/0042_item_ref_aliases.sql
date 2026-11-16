CREATE TABLE `item_ref_aliases` (
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`item_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `number`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_ref_aliases_item` ON `item_ref_aliases` (`item_id`);