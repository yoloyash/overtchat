import "server-only";
import {
  extractReasoningMiddleware,
  wrapLanguageModel,
} from "ai";
import type { JSONValue, LanguageModelV4 } from "@ai-sdk/provider";
import {
  API_FORMAT_IDS,
  getProvider,
  PROVIDER_IDS,
  type ProviderId,
} from "@/lib/providers/catalog";
import { anthropicAdapter } from "@/lib/providers/server/adapters/anthropic";
import { bedrockAdapter } from "@/lib/providers/server/adapters/bedrock";
import { customAdapter } from "@/lib/providers/server/adapters/custom";
import { googleAdapter } from "@/lib/providers/server/adapters/google";
import { openAIAdapter } from "@/lib/providers/server/adapters/openai";
import { ProviderConfigurationError } from "@/lib/providers/server/errors";
import type {
  ProviderAdapter,
  ProviderConnection,
  ProviderModelConfig,
  ToolSelectionStrategy,
} from "@/lib/providers/server/types";

const PROVIDER_REGISTRY: Record<ProviderId, ProviderAdapter> = {
  openai: openAIAdapter,
  anthropic: anthropicAdapter,
  google: googleAdapter,
  bedrock: bedrockAdapter,
  custom: customAdapter,
};

export interface ConfiguredLanguageModel {
  model: LanguageModelV4;
  providerOptions: Record<string, Record<string, JSONValue>> | undefined;
  toolSelectionStrategy: ToolSelectionStrategy;
}

export function createConfiguredLanguageModel(
  config: ProviderModelConfig,
): ConfiguredLanguageModel {
  validateProviderModelConfig(config);
  const adapter = getProviderAdapter(config.providerId);
  let resolved: ReturnType<ProviderAdapter["createLanguageModel"]>;
  try {
    resolved = adapter.createLanguageModel(config);
  } catch (error) {
    if (error instanceof ProviderConfigurationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderConfigurationError(
      `Invalid ${getProvider(config.providerId).label} model configuration: ${message}`,
      { cause: error },
    );
  }
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
            [resolved.providerOptionsKey]: options as Record<string, JSONValue>,
          }
        : undefined,
    // Unknown transports get the cache-safe fallback: keep definitions on the
    // wire and let application approval deny forbidden calls.
    toolSelectionStrategy: resolved.toolSelectionStrategy ?? "approval-only",
  };
}

export function listProviderModels(
  connection: ProviderConnection,
): Promise<string[]> {
  validateProviderConnection(connection);
  return getProviderAdapter(connection.providerId).listModels(connection);
}

export function getProviderAdapter(providerId: ProviderId): ProviderAdapter {
  const adapter = (
    PROVIDER_REGISTRY as Partial<Record<string, ProviderAdapter>>
  )[providerId];
  if (!adapter) {
    throw new ProviderConfigurationError(
      `Unsupported model provider "${providerId}".`,
    );
  }
  return adapter;
}

export function validateProviderConnection(
  connection: ProviderConnection,
): void {
  if (!PROVIDER_IDS.includes(connection.providerId)) {
    throw new ProviderConfigurationError(
      `Unsupported model provider "${connection.providerId}".`,
    );
  }
  if (!API_FORMAT_IDS.includes(connection.apiFormat)) {
    throw new ProviderConfigurationError(
      `Unsupported API format "${connection.apiFormat}".`,
    );
  }

  assertHttpEndpoint(connection.baseUrl);
  const provider = getProvider(connection.providerId);
  if (provider.requiresApiKey && !connection.apiKey?.trim()) {
    throw new ProviderConfigurationError(
      `${provider.label} requires an API key.`,
    );
  }

  if (connection.providerId === "custom") {
    if (connection.apiFormat === "auto") {
      throw new ProviderConfigurationError(
        "Custom providers require an explicit API format.",
      );
    }
  } else if (connection.apiFormat !== "auto") {
    throw new ProviderConfigurationError(
      `${connection.providerId} manages its API format automatically.`,
    );
  }

  getProviderAdapter(connection.providerId).validateConnection?.(connection);
}

export function validateProviderModelConfig(config: ProviderModelConfig): void {
  validateProviderConnection(config);
  if (!config.model?.trim()) {
    throw new ProviderConfigurationError("Model is required.");
  }
  if (
    config.providerOptions != null &&
    (typeof config.providerOptions !== "object" ||
      Array.isArray(config.providerOptions))
  ) {
    throw new ProviderConfigurationError(
      "Provider options must be a JSON object.",
    );
  }
  getProviderAdapter(config.providerId).validateModelConfig?.(config);
}

function assertHttpEndpoint(baseUrl: string): void {
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    throw new ProviderConfigurationError(
      "Endpoint must be an absolute HTTP or HTTPS URL.",
    );
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new ProviderConfigurationError("Endpoint must use HTTP or HTTPS.");
  }
}
