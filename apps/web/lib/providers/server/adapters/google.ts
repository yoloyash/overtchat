import "server-only";
import { listGoogleModels } from "@/lib/providers/server/http";
import { applyGoogleReasoningLevel } from "@/lib/providers/server/adapters/cloud-reasoning";
import { createGoogleGenerativeModel } from "@/lib/providers/server/transports";
import type { ProviderAdapter } from "@/lib/providers/server/types";

const GOOGLE_THINKING_DEFAULTS = {
  thinkingConfig: { includeThoughts: true },
};

export const googleAdapter: ProviderAdapter = {
  id: "google",
  acceptsReasoningLevel: true,
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
      transformProviderOptions: (options) =>
        applyGoogleReasoningLevel(options, config.reasoningLevel),
    };
  },
  listModels(connection) {
    return listGoogleModels(connection.baseUrl, connection.apiKey);
  },
};
