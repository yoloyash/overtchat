export const MODEL_BRAND_ICON_IDS = [
  "anthropic",
  "bedrock",
  "claude",
  "deepseek",
  "gemini",
  "groq",
  "meta",
  "minimax",
  "mistral",
  "ollama",
  "openai",
  "openrouter",
  "qwen",
  "vllm",
] as const;

export type ModelBrandIconId = (typeof MODEL_BRAND_ICON_IDS)[number];

export interface PublicModelConfig {
  id: string;
  label: string;
  displayProvider: string;
  providerIconId?: ModelBrandIconId;
  modelIconId?: ModelBrandIconId;
  model: string;
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
