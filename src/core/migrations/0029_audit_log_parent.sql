ALTER TABLE `audit_log` ADD `parent_id` text;--> statement-breakpoint
CREATE INDEX `audit_log_parent_ts` ON `audit_log` (`parent_id`,`ts`);--> statement-breakpoint
-- Hand-added: earlier rows didn't record a parent, so take each item's current
-- one. Rows of sub-items already deleted stay without one; nothing says whose
-- they were.
UPDATE `audit_log` SET `parent_id` = (SELECT `parent_id` FROM `items` WHERE `items`.`id` = `audit_log`.`entity_id`) WHERE `entity_type` = 'item';
