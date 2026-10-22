import type {
  ChatReasoningLevel,
  LocalReasoningMapping,
} from "@overtchat/shared";

export function applyLocalReasoningLevel(
  body: Record<string, unknown>,
  level: ChatReasoningLevel | undefined,
  mapping?: LocalReasoningMapping,
): Record<string, unknown> {
  if (!level || level === "default") return body;

  const existingTemplateKwargs = isRecord(body.chat_template_kwargs)
    ? body.chat_template_kwargs
    : {};
  const enabled = level !== "off";
  if (mapping) {
    const kwargs = { ...existingTemplateKwargs };
    delete kwargs.enable_thinking;
    delete kwargs.thinking;
    delete kwargs.reasoning_effort;
    const result: Record<string, unknown> = {
      ...body,
      chat_template_kwargs: kwargs,
    };
    delete result.reasoning_effort;
    if (mapping.toggleParameter) kwargs[mapping.toggleParameter] = enabled;
    const effort =
      level === "off" ? "none" : level === "on" ? undefined : level;
    if (effort !== undefined && mapping.effortParameter) {
      if (mapping.effortParameter === "reasoning_effort")
        result.reasoning_effort = effort;
      else kwargs.reasoning_effort = effort;
    }
    return result;
  }
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
