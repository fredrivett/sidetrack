CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_project_user` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `project_members_user_status` ON `project_members` (`user_id`,`status`,`created_at`);--> statement-breakpoint
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