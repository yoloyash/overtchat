export const MODEL_BRAND_ICON_IDS = [
  "anthropic",
  "bedrock",
  "claude",
  "cohere",
  "deepseek",
  "gemini",
  "gemma",
  "grok",
  "groq",
  "hunyuan",
  "ibm",
  "kimi",
  "meta",
  "minimax",
  "mistral",
  "nova",
  "nvidia",
  "ollama",
  "openai",
  "openrouter",
  "poolside",
  "qwen",
  "stepfun",
  "vllm",
  "xiaomimimo",
  "zai",
] as const;

export type ModelBrandIconId = (typeof MODEL_BRAND_ICON_IDS)[number];

/**
 * Capabilities reported by a provider/runtime or supplied by the exact
 * vendored model catalog. Missing fields are unknown, not false.
 */
export interface ModelCapabilities {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  attachment?: boolean;
  toolCalling?: boolean;
  reasoning?: boolean;
  structuredOutput?: boolean;
  temperature?: boolean;
}

export interface PublicModelConfig {
  id: string;
  label: string;
  displayProvider: string;
  providerIconId?: ModelBrandIconId;
  modelIconId?: ModelBrandIconId;
  model: string;
  contextWindow?: number;
  capabilities?: ModelCapabilities;
  hasProviderOptions: boolean;
  toolCallingEnabled: boolean;
}

/** Treat older servers that omit the capability as tool-capable. */
export function modelSupportsToolCalling(
  model:
    | Partial<Pick<PublicModelConfig, "toolCallingEnabled">>
    | null
    | undefined,
): boolean {
  return Boolean(model && model.toolCallingEnabled !== false);
}
