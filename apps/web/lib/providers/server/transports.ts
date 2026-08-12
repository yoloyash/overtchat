import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenResponses } from "@ai-sdk/open-responses";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  isJSONObject,
  type LanguageModelV4,
  type LanguageModelV4Usage,
} from "@ai-sdk/provider";

interface TransportConfig {
  providerName: string;
  baseUrl: string;
  apiKey: string | null | undefined;
  model: string;
  transformRequestBody?: (
    body: Record<string, unknown>,
  ) => Record<string, unknown>;
}

export function createOpenAIResponsesModel(
  config: TransportConfig,
): LanguageModelV4 {
  return createOpenAI({
    name: config.providerName,
    baseURL: config.baseUrl,
    apiKey: credential(config.apiKey),
  }).responses(config.model);
}

export function createOpenAICompatibleChatModel(
  config: TransportConfig,
): LanguageModelV4 {
  return createOpenAICompatible({
    name: config.providerName,
    baseURL: config.baseUrl,
    apiKey: credential(config.apiKey),
    // OpenAI-compatible servers do not include usage in streamed responses
    // unless the client requests it. vLLM and llama.cpp support this standard
    // stream option, and the final usage chunk supplies the context meter's
    // numerator.
    includeUsage: true,
    convertUsage: convertOpenAICompatibleUsage,
    ...(config.transformRequestBody
      ? { transformRequestBody: config.transformRequestBody }
      : {}),
  }).chatModel(config.model);
}

export function convertOpenAICompatibleUsage(
  usage: unknown,
): LanguageModelV4Usage {
  if (!isJSONObject(usage)) {
    return {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: undefined,
        text: undefined,
        reasoning: undefined,
      },
      raw: undefined,
    };
  }

  const promptTokens = usageNumber(usage.prompt_tokens) ?? 0;
  const completionTokens = usageNumber(usage.completion_tokens) ?? 0;
  const promptDetails = isJSONObject(usage.prompt_tokens_details)
    ? usage.prompt_tokens_details
    : undefined;
  const completionDetails = isJSONObject(usage.completion_tokens_details)
    ? usage.completion_tokens_details
    : undefined;
  const cacheReadTokens =
    usageNumber(usage.prompt_cache_hit_tokens) ??
    usageNumber(promptDetails?.cached_tokens) ??
    0;
  const reasoningTokens =
    usageNumber(completionDetails?.reasoning_tokens) ?? 0;

  return {
    inputTokens: {
      total: promptTokens,
      noCache: Math.max(promptTokens - cacheReadTokens, 0),
      cacheRead: cacheReadTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: completionTokens,
      text: completionTokens - reasoningTokens,
      reasoning: reasoningTokens,
    },
    raw: usage,
  };
}

export function createOpenResponsesModel(
  config: Omit<TransportConfig, "baseUrl"> & { url: string },
): LanguageModelV4 {
  return createOpenResponses({
    name: config.providerName,
    url: config.url,
    apiKey: credential(config.apiKey),
  })(config.model);
}

export function createAnthropicMessagesModel(
  config: TransportConfig & { authentication: "api-key" | "bearer" },
): LanguageModelV4 {
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
): LanguageModelV4 {
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

function usageNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
