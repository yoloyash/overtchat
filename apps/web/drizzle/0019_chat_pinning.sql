ALTER TABLE `chats` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `chats_userId_pinned_updatedAt_idx` ON `chats` (`user_id`,`pinned`,`updated_at`);