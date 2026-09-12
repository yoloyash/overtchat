CREATE TABLE `push_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`token` text NOT NULL,
	`chats` integer DEFAULT false NOT NULL,
	`agents` integer DEFAULT false NOT NULL,
	`previews` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_devices_token_unique` ON `push_devices` (`token`);--> statement-breakpoint
CREATE INDEX `push_devices_user_idx` ON `push_devices` (`user_id`);--> statement-breakpoint
CREATE TABLE `push_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`body` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`receipt_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `push_devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `push_jobs_due_idx` ON `push_jobs` (`next_attempt_at`);