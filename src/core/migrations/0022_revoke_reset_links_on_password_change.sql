-- A password change cancels every reset link the user still holds. Better
-- Auth deletes only the link a reset used, and nothing on a signed-in change,
-- so a link already sent (say, to an inbox someone else can read) could reset
-- the new password until it expired. Done in the audit trigger from 0021, in
-- the same statement as the change, so it covers every path that sets a
-- password. The audit label is read first, while a reset's own link is still
-- present; a signed-in change has had its links cleared before the write (the
-- /change-password hook in better-auth.ts), so it never reads as a reset.
DROP TRIGGER `audit_password_update`;--> statement-breakpoint
CREATE TRIGGER `audit_password_update`
AFTER UPDATE OF `password` ON `accounts`
WHEN NEW.`password` IS NOT OLD.`password`
BEGIN
	INSERT INTO `audit_log` (`id`, `ts`, `actor`, `source`, `action`, `entity_type`, `entity_id`, `project_id`, `detail`)
	VALUES (
		lower(hex(randomblob(6))),
		CAST(unixepoch('subsec') * 1000 AS INTEGER),
		NEW.`user_id`,
		'web',
		'update',
		'profile',
		NEW.`user_id`,
		NULL,
		CASE WHEN EXISTS (
			SELECT 1 FROM `verifications`
			WHERE `identifier` LIKE 'reset-password:%'
				AND `value` = NEW.`user_id`
				AND `expires_at` > CAST(unixepoch('subsec') * 1000 AS INTEGER)
		) THEN 'password via a reset link' ELSE 'password' END
	);
	DELETE FROM `verifications`
	WHERE `identifier` LIKE 'reset-password:%' AND `value` = NEW.`user_id`;
END;
