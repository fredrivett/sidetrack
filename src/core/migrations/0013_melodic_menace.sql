ALTER TABLE `items` ADD `parent_id` text REFERENCES items(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `items_parent` ON `items` (`parent_id`);