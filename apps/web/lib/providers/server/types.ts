import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { ApiFormat, ProviderId } from "@/lib/providers/catalog";

export type ToolSelectionStrategy =
  | "openai-allowed-tools"
  | "tool-choice"
  | "approval-only";

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
}

export interface ResolvedLanguageModel {
  model: LanguageModelV4;
  providerOptionsKey: string;
  defaultProviderOptions?: Record<string, unknown>;
  /** Transport-native way to vary the callable subset without hiding tools. */
  toolSelectionStrategy?: ToolSelectionStrategy;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  validateConnection?(connection: ProviderConnection): void;
  validateModelConfig?(config: ProviderModelConfig): void;
  createLanguageModel(config: ProviderModelConfig): ResolvedLanguageModel;
  listModels(connection: ProviderConnection): Promise<string[]>;
}
