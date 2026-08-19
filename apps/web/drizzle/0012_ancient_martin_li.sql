CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`availability` text DEFAULT 'everyone' NOT NULL,
	`config` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_mcp_server_preferences` (
	`user_id` text NOT NULL,
	`server_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `server_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_mcp_server_preferences_serverId_idx` ON `user_mcp_server_preferences` (`server_id`);