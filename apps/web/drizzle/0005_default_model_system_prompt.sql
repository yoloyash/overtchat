-- Give models that never had a system prompt the same default the editor now
-- prefills for new ones. Rows with a prompt an admin actually wrote are left
-- alone: migrations run unattended on boot, so overwriting them would discard
-- configuration with no prompt and no undo.
UPDATE `model_configs`
SET `system_prompt` = 'You are a helpful assistant chatting with a user in overtchat, a self-hosted chat application.'
WHERE `system_prompt` IS NULL OR trim(`system_prompt`) = '';
