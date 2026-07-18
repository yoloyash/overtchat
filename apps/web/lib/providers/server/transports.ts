import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenResponses } from "@ai-sdk/open-responses";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";

interface TransportConfig {
  providerName: string;
  baseUrl: string;
  apiKey: string | null | undefined;
  model: string;
}

export function createOpenAIResponsesModel(
  config: TransportConfig,
): LanguageModelV3 {
  return createOpenAI({
    name: config.providerName,
    baseURL: config.baseUrl,
    apiKey: credential(config.apiKey),
  }).responses(config.model);
}

export function createOpenAICompatibleChatModel(
  config: TransportConfig,
): LanguageModelV3 {
  return createOpenAICompatible({
    name: config.providerName,
    baseURL: config.baseUrl,
    apiKey: credential(config.apiKey),
  }).chatModel(config.model);
}

export function createOpenResponsesModel(
  config: Omit<TransportConfig, "baseUrl"> & { url: string },
): LanguageModelV3 {
  return createOpenResponses({
    name: config.providerName,
    url: config.url,
    apiKey: credential(config.apiKey),
  })(config.model);
}

export function createAnthropicMessagesModel(
  config: TransportConfig & { authentication: "api-key" | "bearer" },
): LanguageModelV3 {
  const apiKey = credential(config.apiKey);
  return createAnthropic({
    name: `${config.providerName}.messages`,
    baseURL: config.baseUrl,
    ...(config.authentication === "bearer"
      ? { authToken: apiKey }
      : { apiKey }),
  }).messages(config.model);
}

export function createGoogleGenerativeModel(
  config: TransportConfig,
): LanguageModelV3 {
  return createGoogleGenerativeAI({
    name: `${config.providerName}.generative-ai`,
    baseURL: config.baseUrl,
    apiKey: credential(config.apiKey),
  }).chat(config.model);
}

function credential(apiKey: string | null | undefined): string {
  // Always pass a value so a saved connection never silently falls back to a
  // process-wide SDK environment variable.
  return apiKey || "none";
}
