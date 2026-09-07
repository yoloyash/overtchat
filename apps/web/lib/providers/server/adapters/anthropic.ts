import "server-only";
import { listAnthropicModels } from "@/lib/providers/server/http";
import { applyAnthropicReasoningLevel } from "@/lib/providers/server/adapters/cloud-reasoning";
import { createAnthropicMessagesModel } from "@/lib/providers/server/transports";
import type { ProviderAdapter } from "@/lib/providers/server/types";

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  acceptsReasoningLevel: true,
  createLanguageModel(config) {
    return {
      model: createAnthropicMessagesModel({
        providerName: "anthropic",
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        authentication: "api-key",
      }),
      providerOptionsKey: "anthropic",
      transformProviderOptions: (options) =>
        applyAnthropicReasoningLevel(options, config.reasoningLevel),
      promptCacheKind: "anthropic",
    };
  },
  listModels(connection) {
    return listAnthropicModels(connection.baseUrl, connection.apiKey);
  },
};
