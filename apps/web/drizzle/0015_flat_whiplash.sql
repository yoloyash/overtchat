CREATE TABLE `chat_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`user_id` text NOT NULL,
	`client_request_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`response_message_id` text,
	`started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_generations_userId_clientRequestId_idx` ON `chat_generations` (`user_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `chat_generations_chatId_startedAt_idx` ON `chat_generations` (`chat_id`,`started_at`);