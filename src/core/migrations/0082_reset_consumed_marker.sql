-- The password trigger from 0045, which also counts a "reset-consumed" marker
-- as a reset in flight. Better Auth 1.7 consumes a reset link before it writes
-- the new password, so the link is gone by the time the trigger reads it; the
-- /reset-password hook in better-auth.ts leaves the marker first (a
-- verifications row, one minute to live, value the user's id). Otherwise
-- unchanged: whether it was a reset is read first, then the user's reset links
-- and the marker are cancelled.
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
				WHERE (`identifier` LIKE 'reset-password:%' OR `identifier` LIKE 'reset-consumed:%')
					AND `value` = NEW.`user_id`
					AND `expires_at` > CAST(unixepoch('subsec') * 1000 AS INTEGER)
			) THEN 'true' ELSE 'false' END)
		)
	);
	DELETE FROM `verifications`
	WHERE (`identifier` LIKE 'reset-password:%' OR `identifier` LIKE 'reset-consumed:%')
		AND `value` = NEW.`user_id`;
END;
