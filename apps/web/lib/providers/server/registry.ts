import "server-only";
import {
  extractReasoningMiddleware,
  wrapLanguageModel,
  type LanguageModel,
} from "ai";
import type { JSONValue } from "@ai-sdk/provider";
import { PROVIDER_IDS, type ProviderId } from "@/lib/providers/catalog";
import { anthropicAdapter } from "@/lib/providers/server/adapters/anthropic";
import { bedrockAdapter } from "@/lib/providers/server/adapters/bedrock";
import { customAdapter } from "@/lib/providers/server/adapters/custom";
import { googleAdapter } from "@/lib/providers/server/adapters/google";
import { openAIAdapter } from "@/lib/providers/server/adapters/openai";
import type {
  ProviderAdapter,
  ProviderConnection,
  ProviderModelConfig,
} from "@/lib/providers/server/types";

const PROVIDER_REGISTRY: Record<ProviderId, ProviderAdapter> = {
  openai: openAIAdapter,
  anthropic: anthropicAdapter,
  google: googleAdapter,
  bedrock: bedrockAdapter,
  custom: customAdapter,
};

export interface ConfiguredLanguageModel {
  model: LanguageModel;
  providerOptions:
    | Record<string, Record<string, JSONValue>>
    | undefined;
}

export function createConfiguredLanguageModel(
  config: ProviderModelConfig,
): ConfiguredLanguageModel {
  assertApiFormat(config);
  const adapter = getProviderAdapter(config.providerId);
  const resolved = adapter.createLanguageModel(config);
  const options = {
    ...(resolved.defaultProviderOptions ?? {}),
    ...(config.providerOptions ?? {}),
  };

  return {
    model: wrapLanguageModel({
      model: resolved.model,
      middleware: [
        extractReasoningMiddleware({ tagName: "thought" }),
        extractReasoningMiddleware({ tagName: "think" }),
      ],
    }),
    providerOptions:
      Object.keys(options).length > 0
        ? {
            [resolved.providerOptionsKey]: options as Record<
              string,
              JSONValue
            >,
          }
        : undefined,
  };
}

export function listProviderModels(
  connection: ProviderConnection,
): Promise<string[]> {
  assertApiFormat(connection);
  return getProviderAdapter(connection.providerId).listModels(connection);
}

export function getProviderAdapter(providerId: ProviderId): ProviderAdapter {
  return PROVIDER_REGISTRY[providerId];
}

export function registeredProviderIds(): readonly ProviderId[] {
  return PROVIDER_IDS.filter((id) => PROVIDER_REGISTRY[id].id === id);
}

function assertApiFormat(connection: ProviderConnection): void {
  if (connection.providerId === "custom") {
    if (connection.apiFormat === "auto") {
      throw new Error("Custom providers require an explicit API format.");
    }
    return;
  }
  if (connection.apiFormat !== "auto") {
    throw new Error(
      `${connection.providerId} manages its API format automatically.`,
    );
  }
}
