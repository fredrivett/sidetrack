-- Paused lists are now archived: "paused" is no longer a list status. Each
-- move is logged as a system change, in the same transaction, the way
-- updateProject logs a status change.
INSERT INTO `audit_log` (`id`, `ts`, `actor`, `source`, `action`, `entity_type`, `entity_id`, `project_id`, `detail`)
SELECT lower(hex(randomblob(6))), unixepoch() * 1000, 'system', 'system', 'update', 'project', `id`, `id`, `name` || ': status paused→archived (paused lists are now archived)'
FROM `projects` WHERE `status` = 'paused';--> statement-breakpoint
UPDATE `projects` SET `status` = 'archived' WHERE `status` = 'paused';
