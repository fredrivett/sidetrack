CREATE TABLE `day_wrap_ups` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`text` text NOT NULL,
	`closed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
