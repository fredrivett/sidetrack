ALTER TABLE `items` ADD `assignee_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Hand-added: carry each existing single assignee over before the old column goes.
UPDATE `items` SET `assignee_ids` = json_array(`assignee_id`) WHERE `assignee_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `assignee_id`;
