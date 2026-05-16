CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`actor` text DEFAULT 'me' NOT NULL,
	`source` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`project_id` text,
	`detail` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_ts` ON `audit_log` (`ts`);--> statement-breakpoint
CREATE INDEX `audit_log_project_ts` ON `audit_log` (`project_id`,`ts`);