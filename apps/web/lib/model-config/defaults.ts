/**
 * Starting point for a new model's system prompt, applied when the editor opens
 * a blank form. Admins own the field afterwards, so this is a default value and
 * not a runtime fallback — clearing the textarea has to keep the prompt empty.
 *
 * Migration 0005 backfills existing models that never had a prompt with this
 * same text. That copy is frozen; rewording here only affects new models.
 */
export const DEFAULT_MODEL_SYSTEM_PROMPT =
  "You are a helpful assistant chatting with a user in overtchat, a self-hosted chat application.";
