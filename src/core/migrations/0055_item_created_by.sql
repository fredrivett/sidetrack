ALTER TABLE `items` ADD `created_by` text;--> statement-breakpoint
-- Who added each existing item, from its audit row (agents' rows carry their
-- key owner as actor). Items with none stay null and count as anyone's.
UPDATE `items` SET `created_by` = (
  SELECT `actor` FROM `audit_log`
  WHERE `entity_type` = 'item' AND `action` = 'create' AND `entity_id` = `items`.`id` AND `actor` != 'system'
  ORDER BY `ts` LIMIT 1
);
