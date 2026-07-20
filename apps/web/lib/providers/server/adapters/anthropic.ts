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
      // Anthropic has no native `none`; its SDK implements that choice by
      // removing all tool definitions, which would break the stable prefix.
      toolSelectionStrategy: "approval-only",
    };
  },
  listModels(connection) {
    return listAnthropicModels(connection.baseUrl, connection.apiKey);
  },
};
