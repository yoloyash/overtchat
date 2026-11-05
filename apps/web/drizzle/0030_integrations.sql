CREATE TABLE `integration_authorizations` (
	`user_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`state` text NOT NULL,
	`code_verifier` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `integration_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`user_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`account_email` text NOT NULL,
	`refresh_token` text NOT NULL,
	`refresh_token_expires_at` integer,
	`access_token` text,
	`access_token_expires_at` integer,
	`status` text DEFAULT 'connected' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `integration_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `integration_oauth_clients` (
	`provider` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
