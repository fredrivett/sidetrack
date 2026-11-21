CREATE TABLE `two_factors` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `two_factors_user_id` ON `two_factors` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `two_factor_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Audit two-factor sign-in, which Better Auth's twoFactor plugin writes
-- itself (transactions off, no hook sees the user and the write together),
-- with triggers like audit_password_update (migration 0045): the change and
-- its row commit or fail together. Turning it on or off also forgets every
-- device the user told to skip the code, so a device trusted before it was
-- turned off doesn't skip a fresh setup.
CREATE TRIGGER `audit_two_factor_update`
AFTER UPDATE OF `two_factor_enabled` ON `users`
WHEN NEW.`two_factor_enabled` IS NOT OLD.`two_factor_enabled`
BEGIN
	INSERT INTO `audit_log` (`id`, `ts`, `actor`, `source`, `action`, `entity_type`, `entity_id`, `project_id`, `detail`, `event`)
	VALUES (
		lower(hex(randomblob(6))),
		CAST(unixepoch('subsec') * 1000 AS INTEGER),
		NEW.`id`,
		'web',
		'update',
		'profile',
		NEW.`id`,
		NULL,
		'',
		json_object(
			'type', 'profile.two_factor',
			'userId', NEW.`id`,
			'enabled', json(CASE WHEN NEW.`two_factor_enabled` THEN 'true' ELSE 'false' END)
		)
	);
	DELETE FROM `verifications`
	WHERE `identifier` LIKE 'trust-device-%' AND `value` = NEW.`id`;
END;
--> statement-breakpoint
-- New backup codes, or one used up. Better Auth stores them encrypted, beside
-- how many are left (`left`, see better-auth.ts): one fewer is a code used,
-- anything else (ten again) a new set.
CREATE TRIGGER `audit_backup_codes_update`
AFTER UPDATE OF `backup_codes` ON `two_factors`
WHEN NEW.`backup_codes` IS NOT OLD.`backup_codes`
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
			'type', 'profile.backup_codes',
			'userId', NEW.`user_id`,
			'used', json(CASE WHEN json_extract(NEW.`backup_codes`, '$.left') < json_extract(OLD.`backup_codes`, '$.left')
				THEN 'true' ELSE 'false' END)
		)
	);
END;
