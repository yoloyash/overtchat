CREATE TABLE `generation_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text,
	`message_id` text,
	`context` text DEFAULT 'chat' NOT NULL,
	`occurred_at` integer NOT NULL,
	`provider_id` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer,
	`uncached_input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`total_tokens` integer,
	`finish_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `generation_usage_userId_occurredAt_idx` ON `generation_usage` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `generation_usage_userId_providerId_model_occurredAt_idx` ON `generation_usage` (`user_id`,`provider_id`,`model`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `generation_usage_context_occurredAt_idx` ON `generation_usage` (`context`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `generation_usage_chatId_idx` ON `generation_usage` (`chat_id`);--> statement-breakpoint
CREATE INDEX `generation_usage_messageId_idx` ON `generation_usage` (`message_id`);
