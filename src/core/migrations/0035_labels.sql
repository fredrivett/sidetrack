ALTER TABLE `categories` RENAME TO `labels`;--> statement-breakpoint
DROP INDEX `categories_project_name`;--> statement-breakpoint
ALTER TABLE `labels` ADD `emoji` text;--> statement-breakpoint
ALTER TABLE `labels` ADD `emoji_chosen` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `labels_project_name` ON `labels` (`project_id`,`name`);--> statement-breakpoint
-- Each item's category becomes its one label. Every category an item used
-- should already be a row (addItem/updateItem registered it), but make sure.
INSERT OR IGNORE INTO `labels` (`id`, `project_id`, `name`)
  SELECT lower(hex(randomblob(6))), `project_id`, `category` FROM `items`
  WHERE `category` IS NOT NULL GROUP BY `project_id`, `category`;--> statement-breakpoint
ALTER TABLE `items` ADD `labels` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `items` SET `labels` = json_array(`category`) WHERE `category` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `category`;--> statement-breakpoint
ALTER TABLE `projects` ADD `icon_chosen` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- An icon set before this was either picked or kept from New list's
-- suggestion; either way someone saw it, so keep it as chosen.
UPDATE `projects` SET `icon_chosen` = true WHERE `icon` IS NOT NULL;
