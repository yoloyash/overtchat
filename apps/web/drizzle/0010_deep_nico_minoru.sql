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
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `host_connectors_userId_idx` ON `host_connectors` (`user_id`);
