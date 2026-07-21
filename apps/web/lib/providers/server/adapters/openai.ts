import "server-only";
import { listOpenAIModels } from "@/lib/providers/server/http";
import { createOpenAIResponsesModel } from "@/lib/providers/server/transports";
import type { ProviderAdapter } from "@/lib/providers/server/types";

export const openAIAdapter: ProviderAdapter = {
  id: "openai",
  createLanguageModel(config) {
    return {
      model: createOpenAIResponsesModel({
        providerName: "openai",
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
      }),
      providerOptionsKey: "openai",
    };
  },
  listModels(connection) {
    return listOpenAIModels(connection.baseUrl, connection.apiKey);
  },
};
