CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`inviter_id` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`places` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_by` text,
	`accepted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_inviter` ON `invitations` (`inviter_id`,`created_at`);