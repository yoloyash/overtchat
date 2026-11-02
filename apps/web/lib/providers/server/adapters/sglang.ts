import "server-only";
import { createOpenAICompatibleAdapter } from "@/lib/providers/server/adapters/openai-compatible";

import { applyLocalReasoningLevel } from "./local-reasoning";

export const sglangAdapter = createOpenAICompatibleAdapter("sglang", {
  acceptsReasoningLevel: true,
  transformRequestBody: (body, config) =>
    applyLocalReasoningLevel(
      body,
      config.reasoningLevel,
      config.reasoningRequest,
    ),
});
