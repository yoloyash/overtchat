import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { ChatReasoningLevel, ModelCapabilities } from "@overtchat/shared";
import type { ApiFormat, ProviderId } from "@/lib/providers/catalog";

export interface ProviderConnection {
  providerId: ProviderId;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey: string | null | undefined;
}

export interface ProviderModelConfig extends ProviderConnection {
  model: string;
  providerOptions: Record<string, unknown> | null | undefined;
  /** App capability policy; provider adapters do not infer this from model IDs. */
  toolCallingEnabled?: boolean;
  supportsImageInput?: boolean;
  /** Per-chat override. Provider adapters decide whether and how to consume it. */
  reasoningLevel?: ChatReasoningLevel;
}

export interface ResolvedLanguageModel {
  model: LanguageModelV4;
  providerOptionsKey: string;
  defaultProviderOptions?: Record<string, unknown>;
  promptCacheKind?: "anthropic" | "openai";
}

export interface DiscoveredModel {
  id: string;
  contextWindow?: number;
  capabilities?: ModelCapabilities;
}

export type AnthropicCacheControl = NonNullable<
  AnthropicProviderOptions["cacheControl"]
>;

export type PromptCacheStrategy =
  | { kind: "anthropic"; cacheControl: AnthropicCacheControl }
  | { kind: "openai" };

export interface ProviderAdapter {
  readonly id: ProviderId;
  /** The adapter consumes `reasoningLevel` instead of silently ignoring it. */
  readonly acceptsReasoningLevel?: boolean;
  validateConnection?(connection: ProviderConnection): void;
  validateModelConfig?(config: ProviderModelConfig): void;
  createLanguageModel(config: ProviderModelConfig): ResolvedLanguageModel;
  listModels(connection: ProviderConnection): Promise<DiscoveredModel[]>;
}
