CREATE TABLE `notification_settings` (
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`level` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `scope`)
);
