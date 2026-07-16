import "server-only";
import { appendPath, listAnthropicModels, listOpenAIModels } from "@/lib/providers/server/http";
import {
  createAnthropicMessagesModel,
  createOpenAICompatibleChatModel,
  createOpenResponsesModel,
} from "@/lib/providers/server/transports";
import type {
  ProviderAdapter,
  ProviderConnection,
  ProviderModelConfig,
  ResolvedLanguageModel,
} from "@/lib/providers/server/types";

export const customAdapter: ProviderAdapter = {
  id: "custom",
  createLanguageModel: createCustomLanguageModel,
  listModels: listCustomModels,
};

function createCustomLanguageModel(
  config: ProviderModelConfig,
): ResolvedLanguageModel {
  switch (config.apiFormat) {
    case "openai-chat":
      return {
        model: createOpenAICompatibleChatModel({
          providerName: "custom",
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
        }),
        providerOptionsKey: "custom",
      };
    case "openai-responses":
      return {
        model: createOpenResponsesModel({
          providerName: "custom",
          url: appendPath(config.baseUrl, "responses"),
          apiKey: config.apiKey,
          model: config.model,
        }),
        providerOptionsKey: "custom",
      };
    case "anthropic-messages":
      return {
        model: createAnthropicMessagesModel({
          providerName: "custom",
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          authentication: "api-key",
        }),
        providerOptionsKey: "custom",
      };
    case "auto":
      throw new Error("Custom providers require an explicit API format.");
  }
}

function listCustomModels(connection: ProviderConnection): Promise<string[]> {
  switch (connection.apiFormat) {
    case "openai-chat":
    case "openai-responses":
      return listOpenAIModels(connection.baseUrl, connection.apiKey);
    case "anthropic-messages":
      return listAnthropicModels(connection.baseUrl, connection.apiKey);
    case "auto":
      throw new Error("Custom providers require an explicit API format.");
  }
}
