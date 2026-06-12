CREATE TABLE `project_positions` (
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`position` text NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `project_positions` (`user_id`, `project_id`, `position`) SELECT `user_id`, `id`, `position` FROM `projects`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `position`;