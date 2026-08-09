CREATE TABLE `agent_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`provider` text NOT NULL,
	`executable` text NOT NULL,
	`shell_mode` text DEFAULT 'login' NOT NULL,
	`detected_version` text,
	`last_validated_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `agent_hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_connections_hostId_provider_idx` ON `agent_connections` (`host_id`,`provider`);--> statement-breakpoint
CREATE TABLE `agent_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`name` text NOT NULL,
	`transport` text NOT NULL,
	`ssh_alias` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `host_connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_hosts_userId_updatedAt_idx` ON `agent_hosts` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agent_hosts_connectorId_idx` ON `agent_hosts` (`connector_id`);--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider_session_id` text NOT NULL,
	`provider_session_path` text NOT NULL,
	`name` text,
	`first_message` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`provider_created_at` integer,
	`provider_modified_at` integer,
	`last_synced_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `agent_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_sessions_workspaceId_providerSessionPath_idx` ON `agent_sessions` (`workspace_id`,`provider_session_path`);--> statement-breakpoint
CREATE INDEX `agent_sessions_workspaceId_providerModifiedAt_idx` ON `agent_sessions` (`workspace_id`,`provider_modified_at`);--> statement-breakpoint
CREATE TABLE `agent_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `agent_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_workspaces_connectionId_path_idx` ON `agent_workspaces` (`connection_id`,`path`);--> statement-breakpoint
CREATE TABLE `host_connector_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`secret_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `host_connector_pairings_userId_idx` ON `host_connector_pairings` (`user_id`);--> statement-breakpoint
CREATE TABLE `host_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`version` text,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `host_connectors_userId_idx` ON `host_connectors` (`user_id`);