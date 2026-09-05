import "server-only";
import {
  applyDeepSeekReasoningBody,
  applyDeepSeekReasoningOptions,
} from "@/lib/providers/server/adapters/cloud-reasoning";
import { listOpenAIModels } from "@/lib/providers/server/http";
import { createOpenAICompatibleChatModel } from "@/lib/providers/server/transports";
import type { ProviderAdapter } from "@/lib/providers/server/types";
import type { ChatReasoningLevel } from "@overtchat/shared";

export const deepSeekAdapter: ProviderAdapter = {
  id: "deepseek",
  acceptsReasoningLevel: true,
  createLanguageModel(config) {
    return {
      model: createOpenAICompatibleChatModel({
        providerName: "deepseek",
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        supportsImageInput: config.supportsImageInput,
        transformRequestBody: (body) =>
          prepareDeepSeekRequest(body, config.reasoningLevel),
      }),
      providerOptionsKey: "deepseek",
      transformProviderOptions: (options) =>
        applyDeepSeekReasoningOptions(options, config.reasoningLevel),
    };
  },
  listModels(connection) {
    return listOpenAIModels(connection.baseUrl, connection.apiKey);
  },
};

/** DeepSeek defaults to thinking mode, which rejects forced tool choice. */
export function prepareDeepSeekRequest(
  body: Record<string, unknown>,
  reasoningLevel?: ChatReasoningLevel,
): Record<string, unknown> {
  const withReasoning = applyDeepSeekReasoningBody(body, reasoningLevel);
  if (withReasoning.tool_choice !== "required") return withReasoning;
  const thinking = withReasoning.thinking;
  if (
    thinking &&
    typeof thinking === "object" &&
    !Array.isArray(thinking) &&
    (thinking as Record<string, unknown>).type === "disabled"
  ) {
    return withReasoning;
  }
  const { tool_choice: _unsupported, ...compatible } = withReasoning;
  void _unsupported;
  return compatible;
}
