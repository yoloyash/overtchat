import "server-only";
import { createOpenAICompatibleAdapter } from "@/lib/providers/server/adapters/openai-compatible";
import { applyLocalReasoningLevel } from "@/lib/providers/server/adapters/local-reasoning";

export const vllmAdapter = createOpenAICompatibleAdapter(
  "vllm",
  {
    transformRequestBody: (body, config) =>
      applyLocalReasoningLevel(
        body,
        config.reasoningLevel,
        config.reasoningRequest,
      ),
    acceptsReasoningLevel: true,
    assistantContinuationOptions: {
      continue_final_message: true,
      add_generation_prompt: false,
    },
  },
);
