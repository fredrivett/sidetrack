CREATE TABLE `calendar_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`username` text NOT NULL,
	`secret` text NOT NULL,
	`home_url` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_synced_at` integer,
	`last_error` text,
	`needs_reconnect` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_accounts_user` ON `calendar_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`uid` text NOT NULL,
	`recurrence_id` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`all_day` integer NOT NULL,
	`start_day` text,
	`end_day` text,
	`tentative` integer NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_events_calendar_start` ON `calendar_events` (`calendar_id`,`start`);--> statement-breakpoint
CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remote_url` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`included` integer DEFAULT true NOT NULL,
	`ctag` text,
	`events_fetched_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `calendar_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendars_account_url` ON `calendars` (`account_id`,`remote_url`);