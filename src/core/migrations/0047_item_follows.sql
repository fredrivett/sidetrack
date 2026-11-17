CREATE TABLE `item_follows` (
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`following` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`item_id`, `user_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_follows_user` ON `item_follows` (`user_id`);