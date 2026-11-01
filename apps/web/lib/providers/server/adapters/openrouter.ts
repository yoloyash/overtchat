import "server-only";
import type { ChatReasoningLevel } from "@overtchat/shared";
import { createOpenAICompatibleAdapter } from "@/lib/providers/server/adapters/openai-compatible";
import { applyLocalReasoningLevel } from "@/lib/providers/server/adapters/local-reasoning";
import type { ReasoningRequestFields } from "@/lib/model-config/reasoning-override";

/**
 * OpenRouter's unified reasoning parameter. Effort names match the levels its
 * model list reports, so no remapping is needed; "off" uses the documented
 * `none` effort. An administrator's override still replaces these fields.
 */
export function openRouterReasoningFields(
  level: Exclude<ChatReasoningLevel, "default">,
): ReasoningRequestFields {
  if (level === "on") return { reasoning: { enabled: true } };
  return { reasoning: { effort: level === "off" ? "none" : level } };
}

export const openRouterAdapter = createOpenAICompatibleAdapter("openrouter", {
  acceptsReasoningLevel: true,
  transformRequestBody: (body, config) =>
    applyLocalReasoningLevel(
      body,
      config.reasoningLevel,
      config.reasoningRequest ??
        (config.reasoningLevel && config.reasoningLevel !== "default"
          ? openRouterReasoningFields(config.reasoningLevel)
          : undefined),
    ),
});
