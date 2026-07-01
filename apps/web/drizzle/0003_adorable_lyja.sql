CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`transport` text DEFAULT 'stdio' NOT NULL,
	`command` text NOT NULL,
	`args` text NOT NULL,
	`env` text NOT NULL,
	`cwd` text,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_slug_idx` ON `mcp_servers` (`slug`);--> statement-breakpoint
CREATE INDEX `mcp_servers_enabled_sort_idx` ON `mcp_servers` (`enabled`,`sort_order`);--> statement-breakpoint
CREATE TABLE `tool_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`web_search_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
