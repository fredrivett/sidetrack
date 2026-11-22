ALTER TABLE `items` ADD `cancelled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `cancel_reason` text;--> statement-breakpoint
ALTER TABLE `items` ADD `replaced_by_id` text REFERENCES items(id) ON DELETE SET NULL;