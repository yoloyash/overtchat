import "server-only";
import { listOpenAIModels } from "@/lib/providers/server/http";
import { applyOpenAIReasoningLevel } from "@/lib/providers/server/adapters/cloud-reasoning";
import { createOpenAIResponsesModel } from "@/lib/providers/server/transports";
import type { ProviderAdapter } from "@/lib/providers/server/types";

export const openAIAdapter: ProviderAdapter = {
  id: "openai",
  acceptsReasoningLevel: true,
  createLanguageModel(config) {
    return {
      model: createOpenAIResponsesModel({
        providerName: "openai",
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
      }),
      providerOptionsKey: "openai",
      transformProviderOptions: (options) =>
        applyOpenAIReasoningLevel(options, config.reasoningLevel),
      promptCacheKind: "openai",
    };
  },
  listModels(connection) {
    return listOpenAIModels(connection.baseUrl, connection.apiKey);
  },
};
