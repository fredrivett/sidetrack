-- The password trigger from 0022, now writing a change event (core/events.ts,
-- `profile.password`) instead of free text, like every other audit row.
-- Otherwise unchanged: whether it was a reset is read first, while a reset's
-- own link is still present, then the user's reset links are cancelled.
DROP TRIGGER `audit_password_update`;--> statement-breakpoint
CREATE TRIGGER `audit_password_update`
AFTER UPDATE OF `password` ON `accounts`
WHEN NEW.`password` IS NOT OLD.`password`
BEGIN
	INSERT INTO `audit_log` (`id`, `ts`, `actor`, `source`, `action`, `entity_type`, `entity_id`, `project_id`, `detail`, `event`)
	VALUES (
		lower(hex(randomblob(6))),
		CAST(unixepoch('subsec') * 1000 AS INTEGER),
		NEW.`user_id`,
		'web',
		'update',
		'profile',
		NEW.`user_id`,
		NULL,
		'',
		json_object(
			'type', 'profile.password',
			'userId', NEW.`user_id`,
			'viaReset', json(CASE WHEN EXISTS (
				SELECT 1 FROM `verifications`
				WHERE `identifier` LIKE 'reset-password:%'
					AND `value` = NEW.`user_id`
					AND `expires_at` > CAST(unixepoch('subsec') * 1000 AS INTEGER)
			) THEN 'true' ELSE 'false' END)
		)
	);
	DELETE FROM `verifications`
	WHERE `identifier` LIKE 'reset-password:%' AND `value` = NEW.`user_id`;
END;
