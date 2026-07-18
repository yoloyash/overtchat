import "server-only";
import { listGoogleModels } from "@/lib/providers/server/http";
import { createGoogleGenerativeModel } from "@/lib/providers/server/transports";
import type { ProviderAdapter } from "@/lib/providers/server/types";

const GOOGLE_THINKING_DEFAULTS = {
  thinkingConfig: { includeThoughts: true },
};

export const googleAdapter: ProviderAdapter = {
  id: "google",
  createLanguageModel(config) {
    return {
      model: createGoogleGenerativeModel({
        providerName: "google",
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
      }),
      providerOptionsKey: "google",
      defaultProviderOptions: GOOGLE_THINKING_DEFAULTS,
    };
  },
  listModels(connection) {
    return listGoogleModels(connection.baseUrl, connection.apiKey);
  },
};
