import "server-only";
import { listAnthropicModels } from "@/lib/providers/server/http";
import { createAnthropicMessagesModel } from "@/lib/providers/server/transports";
import type { ProviderAdapter } from "@/lib/providers/server/types";

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
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
    };
  },
  listModels(connection) {
    return listAnthropicModels(connection.baseUrl, connection.apiKey);
  },
};
