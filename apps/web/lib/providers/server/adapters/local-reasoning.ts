import type { ChatReasoningLevel } from "@overtchat/shared";

export function applyLocalReasoningLevel(
  body: Record<string, unknown>,
  level: ChatReasoningLevel | undefined,
): Record<string, unknown> {
  if (!level || level === "default") return body;

  const existingTemplateKwargs = isRecord(body.chat_template_kwargs)
    ? body.chat_template_kwargs
    : {};
  const enabled = level !== "off";
  return {
    ...body,
    reasoning_effort:
      level === "off" ? "none" : level === "on" ? undefined : level,
    chat_template_kwargs: {
      ...existingTemplateKwargs,
      enable_thinking: enabled,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
