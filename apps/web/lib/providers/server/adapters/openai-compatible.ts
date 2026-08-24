import "server-only";
import { listOpenAIModels } from "@/lib/providers/server/http";
import { createOpenAICompatibleChatModel } from "@/lib/providers/server/transports";
import type {
  DiscoveredModel,
  ProviderAdapter,
  ProviderConnection,
} from "@/lib/providers/server/types";
import type { ProviderId } from "@/lib/providers/catalog";

type ListModels = (
  connection: ProviderConnection,
) => Promise<DiscoveredModel[]>;

export function createOpenAICompatibleAdapter(
  id: ProviderId,
  listModels: ListModels = (connection) =>
    listOpenAIModels(connection.baseUrl, connection.apiKey),
): ProviderAdapter {
  return {
    id,
    createLanguageModel(config) {
      return {
        model: createOpenAICompatibleChatModel({
          providerName: id,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          supportsImageInput: config.supportsImageInput,
        }),
        providerOptionsKey: id,
      };
    },
    listModels,
  };
}
