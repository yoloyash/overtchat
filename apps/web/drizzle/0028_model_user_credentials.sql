CREATE TABLE `model_config_user_credentials` (
	`model_config_id` text NOT NULL,
	`user_id` text NOT NULL,
	`api_key` text,
	`base_url` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`model_config_id`, `user_id`),
	FOREIGN KEY (`model_config_id`) REFERENCES `model_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `model_config_user_credentials_userId_idx` ON `model_config_user_credentials` (`user_id`);--> statement-breakpoint
ALTER TABLE `model_configs` ADD `credential_scope` text DEFAULT 'shared' NOT NULL;