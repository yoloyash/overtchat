CREATE TABLE `server_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`bundled_installed` integer DEFAULT false NOT NULL,
	`base_url` text,
	`api_key` text,
	`model` text,
	`voice` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TEMP TABLE `__overtchat_0010_agent_hosts` AS SELECT * FROM `agent_hosts`;--> statement-breakpoint
CREATE TEMP TABLE `__overtchat_0010_agent_connections` AS SELECT * FROM `agent_connections`;--> statement-breakpoint
CREATE TEMP TABLE `__overtchat_0010_agent_workspaces` AS SELECT * FROM `agent_workspaces`;--> statement-breakpoint
CREATE TEMP TABLE `__overtchat_0010_agent_sessions` AS SELECT * FROM `agent_sessions`;--> statement-breakpoint
DELETE FROM `agent_sessions`;--> statement-breakpoint
DELETE FROM `agent_workspaces`;--> statement-breakpoint
DELETE FROM `agent_connections`;--> statement-breakpoint
DELETE FROM `agent_hosts`;--> statement-breakpoint
CREATE TABLE `__new_host_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`managed` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`version` text,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_host_connectors`("id", "user_id", "managed", "name", "token_hash", "version", "last_seen_at", "created_at", "updated_at") SELECT "id", "user_id", false, "name", "token_hash", "version", "last_seen_at", "created_at", "updated_at" FROM `host_connectors`;--> statement-breakpoint
DROP TABLE `host_connectors`;--> statement-breakpoint
ALTER TABLE `__new_host_connectors` RENAME TO `host_connectors`;--> statement-breakpoint
INSERT INTO `agent_hosts` SELECT * FROM `__overtchat_0010_agent_hosts`;--> statement-breakpoint
INSERT INTO `agent_connections` SELECT * FROM `__overtchat_0010_agent_connections`;--> statement-breakpoint
INSERT INTO `agent_workspaces` SELECT * FROM `__overtchat_0010_agent_workspaces`;--> statement-breakpoint
INSERT INTO `agent_sessions` SELECT * FROM `__overtchat_0010_agent_sessions`;--> statement-breakpoint
DROP TABLE `__overtchat_0010_agent_sessions`;--> statement-breakpoint
DROP TABLE `__overtchat_0010_agent_workspaces`;--> statement-breakpoint
DROP TABLE `__overtchat_0010_agent_connections`;--> statement-breakpoint
DROP TABLE `__overtchat_0010_agent_hosts`;--> statement-breakpoint
CREATE UNIQUE INDEX `host_connectors_userId_idx` ON `host_connectors` (`user_id`);
