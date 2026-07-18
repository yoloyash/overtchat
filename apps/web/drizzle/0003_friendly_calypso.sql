ALTER TABLE `model_configs` RENAME COLUMN "extra_body" TO "provider_options";--> statement-breakpoint
ALTER TABLE `model_configs` ADD `provider_id` text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE `model_configs` ADD `api_format` text DEFAULT 'openai-chat' NOT NULL;--> statement-breakpoint
UPDATE `model_configs`
SET
	`provider_id` = CASE
		WHEN `base_url` = 'https://api.openai.com/v1' THEN 'openai'
		WHEN `base_url` = 'https://api.anthropic.com/v1' THEN 'anthropic'
		WHEN `base_url` IN (
			'https://generativelanguage.googleapis.com/v1beta/openai',
			'https://generativelanguage.googleapis.com/v1beta'
		) THEN 'google'
		WHEN `base_url` LIKE 'https://bedrock-mantle.%.api.aws/v1' THEN 'bedrock'
		ELSE 'custom'
	END,
	`api_format` = CASE
		WHEN `base_url` IN (
			'https://api.openai.com/v1',
			'https://api.anthropic.com/v1',
			'https://generativelanguage.googleapis.com/v1beta/openai',
			'https://generativelanguage.googleapis.com/v1beta'
		) OR `base_url` LIKE 'https://bedrock-mantle.%.api.aws/v1' THEN 'auto'
		ELSE 'openai-chat'
	END,
	`base_url` = CASE
		WHEN `base_url` = 'https://generativelanguage.googleapis.com/v1beta/openai'
			THEN 'https://generativelanguage.googleapis.com/v1beta'
		ELSE `base_url`
	END;
