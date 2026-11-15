CREATE TABLE `github_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`secret` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_delivery_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_webhooks_user` ON `github_webhooks` (`user_id`);