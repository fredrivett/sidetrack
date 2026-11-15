ALTER TABLE `audit_log` ADD `parent_id` text;--> statement-breakpoint
CREATE INDEX `audit_log_parent_ts` ON `audit_log` (`parent_id`,`ts`);--> statement-breakpoint
-- Hand-added: earlier rows didn't record a parent. An item's parent only
-- changes through setItemParent, which logs "made … a sub-item of …" or
-- "moved … out of …", so an item with neither has always had its current
-- one. A moved item's rows stay without one, as which parent each belongs to
-- is unknown, and so do a deleted sub-item's.
UPDATE `audit_log` SET `parent_id` = (SELECT `parent_id` FROM `items` WHERE `items`.`id` = `audit_log`.`entity_id`)
WHERE `entity_type` = 'item'
	AND NOT EXISTS (
		SELECT 1 FROM `audit_log` AS `moved`
		WHERE `moved`.`entity_type` = 'item'
			AND `moved`.`entity_id` = `audit_log`.`entity_id`
			AND `moved`.`action` = 'update'
			AND (`moved`.`detail` LIKE 'made "%' OR `moved`.`detail` LIKE 'moved "%')
	);
