ALTER TABLE `two_factors` ADD `failed_verification_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `two_factors` ADD `locked_until` integer;