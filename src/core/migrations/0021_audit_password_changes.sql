-- Audit password changes and resets. Better Auth writes accounts.password
-- itself, with transactions off and no user id in its updateMany hooks, so no
-- hook can write the audit row atomically. A trigger runs inside the UPDATE's
-- own statement, so the change and its row commit or fail together, whichever
-- endpoint (or future code) made it. It mirrors recordAudit: a `profile`
-- update by the account's owner, from the web (passwords only change through
-- Better Auth's web endpoints). A reset is told apart by its unexpired
-- reset-password token, still present while Better Auth writes the password;
-- an unused reset email from the last hour would label a signed-in change as
-- a reset too, which still logs the change.
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
END;
