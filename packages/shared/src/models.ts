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
  "llamacpp",
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
  "sglang",
  "stepfun",
  "vllm",
  "xiaomimimo",
  "zai",
] as const;

export type ModelBrandIconId = (typeof MODEL_BRAND_ICON_IDS)[number];

export const REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type ModelReasoningLevel = "off" | "on" | ReasoningEffort;

/** Request fields used by an OpenAI-compatible model's loaded template. */
export interface LocalReasoningMapping {
  toggleParameter?: "enable_thinking" | "thinking";
  effortParameter?: "reasoning_effort" | "chat_template_kwargs.reasoning_effort";
}

export interface ModelReasoningControls {
  /** The detected or administrator-configured model supports disabling thinking. */
  toggle: boolean;
  /** Known server default; omitted when it cannot be identified. */
  defaultLevel?: ModelReasoningLevel;
  /** Detected or administrator-configured effort choices. */
  efforts?: ReasoningEffort[];
  /** Absent for cloud adapters and older saved discovery results. */
  requestMapping?: LocalReasoningMapping;
}

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
  reasoningControls?: ModelReasoningControls;
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
