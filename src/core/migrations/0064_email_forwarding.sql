CREATE TABLE `email_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_received_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_addresses_user` ON `email_addresses` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_addresses_token` ON `email_addresses` (`token`);--> statement-breakpoint
CREATE TABLE `inbound_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`message_id` text NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text,
	`subject` text NOT NULL,
	`text` text NOT NULL,
	`sent_at` integer,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_emails_message` ON `inbound_emails` (`user_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `inbound_emails_user_received` ON `inbound_emails` (`user_id`,`received_at`);