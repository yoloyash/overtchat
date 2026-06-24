export const MODEL_BRAND_ICON_IDS = [
  "anthropic",
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
  hasExtraBody: boolean;
}
