CREATE TABLE `user_model_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`default_model_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_model_id`) REFERENCES `model_configs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `model_config_id` text REFERENCES model_configs(id) ON DELETE SET NULL;
--> statement-breakpoint
-- Recover the last model used in existing chats when its identity is known.
-- Older responses only recorded the model name; use that only if unambiguous.
WITH latest_models AS (
  SELECT chat_id,
    json_extract(metadata, '$.contextEstimate.modelConfigId') AS config_id,
    json_extract(metadata, '$.stats.model') AS model,
    row_number() OVER (PARTITION BY chat_id ORDER BY created_at DESC, rowid DESC) AS position
  FROM messages
  WHERE role = 'assistant' AND json_valid(metadata)
    AND (json_extract(metadata, '$.contextEstimate.modelConfigId') IS NOT NULL
      OR json_extract(metadata, '$.stats.model') IS NOT NULL)
), unique_models AS (
  SELECT model, min(id) AS id FROM model_configs
  WHERE model_type = 'chat'
  GROUP BY model HAVING count(*) = 1
)
UPDATE chats SET model_config_id = (
  SELECT coalesce(exact.id, legacy.id)
  FROM latest_models AS latest
  LEFT JOIN model_configs AS exact ON exact.id = latest.config_id AND exact.model_type = 'chat'
  LEFT JOIN unique_models AS legacy ON legacy.model = latest.model
  WHERE latest.chat_id = chats.id AND latest.position = 1
);
