CREATE TABLE `ai_prices` (
	`model` text NOT NULL,
	`from` text NOT NULL,
	`input` real NOT NULL,
	`output` real NOT NULL,
	`cache_read` real NOT NULL,
	`cache_write` real NOT NULL,
	PRIMARY KEY(`model`, `from`)
);
--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`feature` text NOT NULL,
	`model` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day`, `feature`, `model`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_usage_day_idx` ON `ai_usage` (`day`);