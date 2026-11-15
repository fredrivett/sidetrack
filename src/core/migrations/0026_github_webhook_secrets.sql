CREATE TABLE `github_webhook_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`name` text NOT NULL,
	`secret` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_delivery_at` integer,
	FOREIGN KEY (`webhook_id`) REFERENCES `github_webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `github_webhook_secrets_webhook` ON `github_webhook_secrets` (`webhook_id`);--> statement-breakpoint
-- Each webhook's one secret so far, keeping its last delivery; it reuses the
-- webhook's id, which is unique here too.
INSERT INTO `github_webhook_secrets` (`id`, `webhook_id`, `name`, `secret`, `created_at`, `last_delivery_at`) SELECT `id`, `id`, 'Original secret', `secret`, `created_at`, `last_delivery_at` FROM `github_webhooks`;--> statement-breakpoint
ALTER TABLE `github_webhooks` DROP COLUMN `secret`;--> statement-breakpoint
ALTER TABLE `github_webhooks` DROP COLUMN `last_delivery_at`;