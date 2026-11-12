CREATE TABLE `gmail_emails` (
	`user_id` text NOT NULL,
	`email_id` text NOT NULL,
	`draft_id` text,
	`thread_id` text,
	`sent_at` integer,
	PRIMARY KEY(`user_id`, `email_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
