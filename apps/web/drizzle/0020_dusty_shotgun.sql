CREATE TABLE `voice_sessions` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`auth_session_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`auth_session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_sessions_id_unique` ON `voice_sessions` (`id`);