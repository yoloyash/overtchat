ALTER TABLE `messages` ADD `metadata` text;--> statement-breakpoint
ALTER TABLE `model_configs` ADD `context_window` integer;--> statement-breakpoint
ALTER TABLE `model_configs` ADD `discovered_context_window` integer;--> statement-breakpoint
ALTER TABLE `model_configs` ADD `discovered_capabilities` text;