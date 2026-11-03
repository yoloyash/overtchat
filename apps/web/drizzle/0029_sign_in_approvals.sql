CREATE TABLE `sign_in_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`challenge` text NOT NULL,
	`code` text,
	`number` integer NOT NULL,
	`choices` text NOT NULL,
	`device` text NOT NULL,
	`ip_address` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by_session_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sign_in_approvals_challenge_unique` ON `sign_in_approvals` (`challenge`);--> statement-breakpoint
CREATE INDEX `sign_in_approvals_user_idx` ON `sign_in_approvals` (`user_id`);--> statement-breakpoint
ALTER TABLE `push_devices` ADD `sign_ins` integer DEFAULT false NOT NULL;