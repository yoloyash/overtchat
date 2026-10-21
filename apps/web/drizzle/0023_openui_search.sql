-- Preserve existing indexed text/tool content. Pre-release cards without a
-- readable projection remain searchable through their program's labels.
CREATE TEMP TABLE openui_search_backfill AS
SELECT m.id AS message_id, m.chat_id, c.user_id,
  group_concat(COALESCE(
    CASE WHEN json_type(p.value, '$.output.text') = 'text' THEN nullif(json_extract(p.value, '$.output.text'), '') END,
    CASE WHEN json_type(p.value, '$.input.text') = 'text' THEN nullif(json_extract(p.value, '$.input.text'), '') END,
    CASE WHEN json_type(p.value, '$.input.ui') = 'text' THEN json_extract(p.value, '$.input.ui') END,
    ''), char(10)) AS content
FROM messages m JOIN chats c ON c.id = m.chat_id, json_each(m.parts) p
WHERE p.type = 'object' AND json_extract(p.value, '$.type') = 'tool-present_openui'
GROUP BY m.id
HAVING content <> '';
--> statement-breakpoint
UPDATE messages_fts
SET content = content || char(10) || (SELECT content FROM openui_search_backfill b WHERE b.message_id = messages_fts.message_id)
WHERE message_id IN (SELECT message_id FROM openui_search_backfill);
--> statement-breakpoint
INSERT INTO messages_fts (content, message_id, chat_id, user_id)
SELECT content, message_id, chat_id, user_id FROM openui_search_backfill b
WHERE NOT EXISTS (SELECT 1 FROM messages_fts f WHERE f.message_id = b.message_id);
--> statement-breakpoint
DROP TABLE openui_search_backfill;
