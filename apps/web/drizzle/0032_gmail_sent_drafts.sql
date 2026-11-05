CREATE TABLE `gmail_sent_drafts` (
	`user_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`thread_id` text,
	`sent_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `draft_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
