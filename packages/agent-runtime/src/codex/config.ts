import type { AgentModel, AgentThinkingLevel } from "@overtchat/agent-bridge";
import { parseCodexModels, recordOf, stringOf } from "./protocol";

export const CODEX_THINKING_LEVELS: readonly AgentThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function codexConfiguredDefaults(
  resolvedValue: unknown,
  savedValue?: unknown,
) {
  const resolved = recordOf(recordOf(resolvedValue)?.config);
  const saved = recordOf(recordOf(savedValue)?.config);
  const effort = resolved
    ? stringOf(resolved, "model_reasoning_effort")
    : stringOf(saved, "modelReasoningEffort");
  return {
    model: resolved ? stringOf(resolved, "model") : stringOf(saved, "model"),
    provider: stringOf(resolved, "model_provider"),
    thinkingLevel:
      effort && CODEX_THINKING_LEVELS.includes(effort as AgentThinkingLevel)
        ? (effort as AgentThinkingLevel)
        : null,
  };
}

/** model/list can contain only OpenAI models even when Codex uses a custom endpoint. */
export function codexConfiguredModels(
  modelResponse: unknown,
  resolvedConfig: unknown,
  savedConfig?: unknown,
): AgentModel[] {
  const defaults = codexConfiguredDefaults(resolvedConfig, savedConfig);
  let models = parseCodexModels(modelResponse);
  if (
    defaults.provider &&
    defaults.provider !== "openai" &&
    defaults.model &&
    !models.some((model) => model.id === defaults.model)
  ) {
    models = [];
  }
  if (defaults.model && !models.some((model) => model.id === defaults.model)) {
    // A configured ID is usable without catalog metadata. Do not borrow GPT capabilities.
    models.push(...parseCodexModels({ data: [{ model: defaults.model }] }));
  }
  const defaultId = defaults.model ?? models.find((model) => model.isDefault)?.id;
  return models.map((model) => {
    const isDefault = model.id === defaultId;
    const effort = isDefault ? defaults.thinkingLevel : null;
    const options = model.thinkingOptions ?? [];
    return {
      ...model,
      isDefault,
      ...(effort
        ? {
            reasoning: true,
            defaultThinkingOptionId: effort,
            thinkingOptions: [
              ...options.map((option) => ({
                ...option,
                isDefault: option.id === effort,
              })),
              ...(options.some((option) => option.id === effort)
                ? []
                : [{
                    id: effort,
                    label: effort === "xhigh"
                      ? "XHigh"
                      : `${effort[0].toUpperCase()}${effort.slice(1)}`,
                    isDefault: true,
                  }]),
            ],
          }
        : {}),
    };
  });
}
