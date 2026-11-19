CREATE TABLE `agenda_greetings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`greeting` text,
	`asked_at` integer NOT NULL,
	`asked_day` text NOT NULL,
	`asks` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
