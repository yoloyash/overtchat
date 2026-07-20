import "server-only";
import {
  appendPath,
  listOpenAIModels,
  normalizeBaseUrl,
} from "@/lib/providers/server/http";
import {
  createAnthropicMessagesModel,
  createOpenAICompatibleChatModel,
  createOpenResponsesModel,
} from "@/lib/providers/server/transports";
import { ProviderConfigurationError } from "@/lib/providers/server/errors";
import type { ProviderAdapter } from "@/lib/providers/server/types";

export type BedrockTransport =
  | "anthropic-messages"
  | "openai-chat"
  | "openai-responses";

const BEDROCK_CHAT_NAMESPACES = [
  "deepseek.",
  "google.",
  "minimax.",
  "mistral.",
  "moonshotai.",
  "nvidia.",
  "qwen.",
  "writer.",
  "xai.",
  "zai.",
] as const;

export const bedrockAdapter: ProviderAdapter = {
  id: "bedrock",
  validateConnection(connection) {
    getMantleRoot(connection.baseUrl);
  },
  validateModelConfig(config) {
    resolveBedrockTransport(config.model);
  },
  createLanguageModel(config) {
    const transport = resolveBedrockTransport(config.model);
    const mantleRoot = getMantleRoot(config.baseUrl);

    switch (transport) {
      case "anthropic-messages":
        return {
          model: createAnthropicMessagesModel({
            providerName: "bedrock",
            baseUrl: appendPath(mantleRoot, "anthropic/v1"),
            apiKey: config.apiKey,
            model: config.model,
            authentication: "bearer",
          }),
          providerOptionsKey: "bedrock",
          toolSelectionStrategy: "approval-only",
        };
      case "openai-responses":
        return {
          model: createOpenResponsesModel({
            providerName: "bedrock",
            url: appendPath(mantleRoot, "openai/v1/responses"),
            apiKey: config.apiKey,
            model: config.model,
          }),
          providerOptionsKey: "bedrock",
          toolSelectionStrategy: "tool-choice",
        };
      case "openai-chat":
        return {
          model: createOpenAICompatibleChatModel({
            providerName: "bedrock",
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model,
          }),
          providerOptionsKey: "bedrock",
          toolSelectionStrategy: "tool-choice",
        };
    }
  },
  async listModels(connection) {
    const models = await listOpenAIModels(
      connection.baseUrl,
      connection.apiKey,
    );
    return models.filter(isSupportedBedrockModel);
  },
};

export function resolveBedrockTransport(modelId: string): BedrockTransport {
  if (modelId.startsWith("anthropic.")) return "anthropic-messages";

  // Bedrock's proprietary GPT releases use the namespaced OpenAI Responses
  // path. Open-weight GPT OSS releases intentionally remain on Chat
  // Completions and are matched by the branch below.
  if (/^openai\.gpt-\d/.test(modelId)) return "openai-responses";
  if (modelId.startsWith("openai.gpt-oss-")) return "openai-chat";

  if (BEDROCK_CHAT_NAMESPACES.some((prefix) => modelId.startsWith(prefix))) {
    return "openai-chat";
  }

  throw new ProviderConfigurationError(
    `Unsupported Bedrock model "${modelId}": no Mantle API route is registered.`,
  );
}

export function getMantleRoot(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized.endsWith("/v1")) {
    throw new ProviderConfigurationError(
      "Amazon Bedrock endpoints must end with /v1.",
    );
  }
  return normalized.slice(0, -3);
}

function isSupportedBedrockModel(modelId: string): boolean {
  try {
    resolveBedrockTransport(modelId);
    return true;
  } catch {
    return false;
  }
}
