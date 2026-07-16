import type { LanguageModelV3 } from "@ai-sdk/provider";
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
}

export interface ResolvedLanguageModel {
  model: LanguageModelV3;
  providerOptionsKey: string;
  defaultProviderOptions?: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  validateConnection?(connection: ProviderConnection): void;
  validateModelConfig?(config: ProviderModelConfig): void;
  createLanguageModel(config: ProviderModelConfig): ResolvedLanguageModel;
  listModels(connection: ProviderConnection): Promise<string[]>;
}
