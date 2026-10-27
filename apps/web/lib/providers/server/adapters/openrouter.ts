import "server-only";
import { createOpenAICompatibleAdapter } from "@/lib/providers/server/adapters/openai-compatible";

import { applyLocalReasoningLevel } from "./local-reasoning";

// OpenRouter does not report per-model effort levels or defaults, so thinking
// levels come from an administrator's override, as with other chat endpoints.
export const openRouterAdapter = createOpenAICompatibleAdapter("openrouter", {
  acceptsReasoningLevel: true,
  transformRequestBody: (body, config) =>
    applyLocalReasoningLevel(
      body,
      config.reasoningLevel,
      config.reasoningRequest,
    ),
});
