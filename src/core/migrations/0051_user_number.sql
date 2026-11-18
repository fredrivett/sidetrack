ALTER TABLE `users` ADD `user_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `users_user_number_unique` ON `users` (`user_number`);--> statement-breakpoint
-- Number the accounts that already exist in signup order, the first as 1.
UPDATE `users` SET `user_number` = (
	SELECT `n` FROM (
		SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at`, `id`) AS `n` FROM `users`
	) AS `numbered`
	WHERE `numbered`.`id` = `users`.`id`
);--> statement-breakpoint
-- Every new account takes the next number, in the same statement as its
-- insert: SQLite runs one write at a time, so two signups never share one.
-- Better Auth writes users itself, so a trigger covers every path that does.
CREATE TRIGGER `users_number`
AFTER INSERT ON `users`
WHEN NEW.`user_number` IS NULL
BEGIN
	UPDATE `users`
	SET `user_number` = (SELECT COALESCE(MAX(`user_number`), 0) + 1 FROM `users`)
	WHERE `id` = NEW.`id`;
END;
