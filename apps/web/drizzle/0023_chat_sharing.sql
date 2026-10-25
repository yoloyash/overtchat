CREATE TABLE `chat_share_uploads` (
	`share_id` text NOT NULL,
	`upload_id` text NOT NULL,
	PRIMARY KEY(`share_id`, `upload_id`),
	FOREIGN KEY (`share_id`) REFERENCES `chat_shares`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_share_uploads_upload_idx` ON `chat_share_uploads` (`upload_id`);--> statement-breakpoint
CREATE TABLE `chat_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`messages` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_shares_chat_id_unique` ON `chat_shares` (`chat_id`);--> statement-breakpoint
CREATE INDEX `chat_shares_user_idx` ON `chat_shares` (`user_id`);