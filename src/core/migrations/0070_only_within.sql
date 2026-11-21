ALTER TABLE `project_members` ADD `only_within` text;--> statement-breakpoint
ALTER TABLE `project_members` ADD `share_note` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_members` ADD `share_mood` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `space_members` ADD `only_within` text;--> statement-breakpoint
ALTER TABLE `space_members` ADD `share_note` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `space_members` ADD `share_mood` integer DEFAULT false NOT NULL;