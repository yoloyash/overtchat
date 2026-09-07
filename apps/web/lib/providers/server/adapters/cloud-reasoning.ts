import type { ChatReasoningLevel } from "@overtchat/shared";

export function applyOpenAIReasoningLevel(
  options: Record<string, unknown>,
  level: ChatReasoningLevel | undefined,
): Record<string, unknown> {
  if (!level || level === "default") return options;
  const { reasoningEffort: _configuredEffort, ...rest } = options;
  void _configuredEffort;
  return level === "on"
    ? rest
    : {
        ...rest,
        reasoningEffort: level === "off" ? "none" : level,
      };
}

export function applyAnthropicReasoningLevel(
  options: Record<string, unknown>,
  level: ChatReasoningLevel | undefined,
): Record<string, unknown> {
  if (!level || level === "default") return options;
  const {
    effort: _configuredEffort,
    thinking: configuredThinking,
    ...rest
  } = options;
  void _configuredEffort;
  if (level === "off") {
    return { ...rest, thinking: { type: "disabled" } };
  }

  const thinking = isRecord(configuredThinking)
    ? configuredThinking
    : {};
  const { budgetTokens: _configuredBudget, ...thinkingOptions } = thinking;
  void _configuredBudget;
  return {
    ...rest,
    thinking: { ...thinkingOptions, type: "adaptive" },
    ...(level === "on" ? {} : { effort: level }),
  };
}

export function applyGoogleReasoningLevel(
  options: Record<string, unknown>,
  level: ChatReasoningLevel | undefined,
): Record<string, unknown> {
  if (!level || level === "default") return options;
  const configuredThinking = isRecord(options.thinkingConfig)
    ? options.thinkingConfig
    : {};
  const {
    thinkingBudget: _configuredBudget,
    thinkingLevel: _configuredLevel,
    ...thinkingOptions
  } = configuredThinking;
  void _configuredBudget;
  void _configuredLevel;
  return {
    ...options,
    thinkingConfig: {
      ...thinkingOptions,
      ...(level === "off"
        ? { thinkingBudget: 0 }
        : level === "on"
          ? {}
          : { thinkingLevel: level }),
    },
  };
}

export function applyDeepSeekReasoningOptions(
  options: Record<string, unknown>,
  level: ChatReasoningLevel | undefined,
): Record<string, unknown> {
  if (!level || level === "default") return options;
  const { reasoningEffort: _configuredEffort, ...rest } = options;
  void _configuredEffort;
  return level === "off" || level === "on"
    ? rest
    : { ...rest, reasoningEffort: level };
}

export function applyDeepSeekReasoningBody(
  body: Record<string, unknown>,
  level: ChatReasoningLevel | undefined,
): Record<string, unknown> {
  if (!level || level === "default") return body;
  const existingThinking = isRecord(body.thinking) ? body.thinking : {};
  const withThinking: Record<string, unknown> = {
    ...body,
    thinking: {
      ...existingThinking,
      type: level === "off" ? "disabled" : "enabled",
    },
  };
  if (level !== "off" && level !== "on") return withThinking;
  const { reasoning_effort: _configuredEffort, ...rest } = withThinking;
  void _configuredEffort;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
