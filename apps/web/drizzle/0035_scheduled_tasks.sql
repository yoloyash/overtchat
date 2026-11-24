CREATE TABLE `scheduled_task_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`scheduled_for` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`seen_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `scheduled_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_task_runs_occurrence_idx` ON `scheduled_task_runs` (`task_id`,`trigger`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `scheduled_task_runs_task_idx` ON `scheduled_task_runs` (`task_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `scheduled_task_runs_unseen_idx` ON `scheduled_task_runs` (`user_id`,`seen_at`);--> statement-breakpoint
CREATE INDEX `scheduled_task_runs_chat_idx` ON `scheduled_task_runs` (`chat_id`);--> statement-breakpoint
CREATE INDEX `scheduled_task_runs_status_idx` ON `scheduled_task_runs` (`status`);--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`model_config_id` text,
	`project_id` text,
	`web_search_enabled` integer DEFAULT true NOT NULL,
	`schedule` text NOT NULL,
	`time_zone` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`paused_reason` text,
	`next_run_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_config_id`) REFERENCES `model_configs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scheduled_tasks_user_idx` ON `scheduled_tasks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `scheduled_tasks_due_idx` ON `scheduled_tasks` (`enabled`,`next_run_at`);