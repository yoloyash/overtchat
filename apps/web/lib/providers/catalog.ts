import type { ModelBrandIconId } from "@overtchat/shared";

export const PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google",
  "bedrock",
  "custom",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const API_FORMAT_IDS = [
  "auto",
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
] as const;

export type ApiFormat = (typeof API_FORMAT_IDS)[number];
export type ExplicitApiFormat = Exclude<ApiFormat, "auto">;

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  iconId: ModelBrandIconId | null;
  defaultBaseUrl: string;
  defaultApiFormat: ApiFormat;
  modelPlaceholder: string;
  requiresApiKey: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    iconId: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultApiFormat: "auto",
    modelPlaceholder: "gpt-4o-mini",
    requiresApiKey: true,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    iconId: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultApiFormat: "auto",
    modelPlaceholder: "claude-sonnet-4-6",
    requiresApiKey: true,
  },
  google: {
    id: "google",
    label: "Google Gemini",
    iconId: "gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultApiFormat: "auto",
    modelPlaceholder: "gemini-2.5-flash",
    requiresApiKey: true,
  },
  bedrock: {
    id: "bedrock",
    label: "Amazon Bedrock",
    iconId: "bedrock",
    defaultBaseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1",
    defaultApiFormat: "auto",
    modelPlaceholder: "openai.gpt-5.6-terra",
    requiresApiKey: true,
  },
  custom: {
    id: "custom",
    label: "Custom",
    iconId: null,
    defaultBaseUrl: "",
    defaultApiFormat: "openai-chat",
    modelPlaceholder: "model-id",
    requiresApiKey: false,
  },
};

export const API_FORMATS: Record<
  ExplicitApiFormat,
  { id: ExplicitApiFormat; label: string; description: string }
> = {
  "openai-chat": {
    id: "openai-chat",
    label: "OpenAI Chat Completions",
    description: "For OpenAI-compatible /chat/completions endpoints.",
  },
  "openai-responses": {
    id: "openai-responses",
    label: "OpenAI Responses",
    description: "For Open Responses-compatible /responses endpoints.",
  },
  "anthropic-messages": {
    id: "anthropic-messages",
    label: "Anthropic Messages",
    description: "For Anthropic-compatible /messages endpoints.",
  },
};

export const EXPLICIT_API_FORMAT_IDS = Object.keys(
  API_FORMATS,
) as ExplicitApiFormat[];

export function getProvider(providerId: ProviderId): ProviderDefinition {
  return PROVIDERS[providerId];
}

export function modelIconForModel(model: string): ModelBrandIconId | null {
  const normalized = model.toLowerCase();

  if (/\bclaude\b/.test(normalized)) return "claude";
  if (normalized.includes("anthropic")) return "anthropic";
  if (normalized.includes("gemini")) return "gemini";
  if (normalized.includes("gemma")) return "gemma";
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("qwen") || /\bqwq\b/.test(normalized)) return "qwen";
  if (normalized.includes("xiaomi") || /\bmimo\b/.test(normalized)) {
    return "xiaomimimo";
  }
  if (
    normalized.includes("z-ai") ||
    normalized.includes("zai-org") ||
    /\bglm(?:\b|[-_.]\d)/.test(normalized)
  ) {
    return "zai";
  }
  if (normalized.includes("nvidia") || normalized.includes("nemotron")) {
    return "nvidia";
  }
  if (normalized.includes("kimi") || normalized.includes("moonshot")) {
    return "kimi";
  }
  if (normalized.includes("poolside") || normalized.includes("laguna")) {
    return "poolside";
  }
  if (normalized.includes("grok") || normalized.includes("x-ai")) return "grok";
  if (
    normalized.includes("hunyuan") ||
    normalized.includes("tencent/") ||
    /\bhy3\b/.test(normalized)
  ) {
    return "hunyuan";
  }
  if (normalized.includes("stepfun")) return "stepfun";
  if (
    normalized.includes("cohere") ||
    /\bcommand-(?:a|r)\b/.test(normalized) ||
    /\baya-/.test(normalized) ||
    /\bnorth-/.test(normalized)
  ) {
    return "cohere";
  }
  if (
    normalized.includes("ibm-granite") ||
    /\bgranite[-_.\d]/.test(normalized)
  ) {
    return "ibm";
  }
  if (/\bnova(?:\b|[-_.]\w)/.test(normalized)) return "nova";
  if (
    normalized.includes("mistral") ||
    normalized.includes("mixtral") ||
    normalized.includes("codestral") ||
    normalized.includes("magistral")
  ) {
    return "mistral";
  }
  if (normalized.includes("minimax")) return "minimax";
  if (normalized.includes("openrouter")) return "openrouter";
  if (normalized.includes("ollama")) return "ollama";
  if (normalized.includes("vllm")) return "vllm";
  if (normalized.includes("groq")) return "groq";
  if (
    normalized.includes("llama") ||
    normalized.includes("meta-") ||
    normalized.startsWith("meta/")
  ) {
    return "meta";
  }
  if (
    /\bgpt[-\d]/.test(normalized) ||
    normalized.includes("chatgpt") ||
    /\bo[1345](?:-|$)/.test(normalized)
  ) {
    return "openai";
  }

  return null;
}
