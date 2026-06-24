import type { ModelBrandIconId } from "@overtchat/shared";

/** UX preset shown in the dialog dropdown and as picker group headers. */
export type PresetId = "openai" | "anthropic" | "google" | "custom";

export interface Preset {
  label: string;
  defaultBaseUrl: string;
  /** Hostname used as a reverse-lookup key for `presetFor`. */
  hostname: string;
  modelPlaceholder: string;
}

export const PRESETS: Record<PresetId, Preset> = {
  openai: {
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    hostname: "api.openai.com",
    modelPlaceholder: "gpt-4o-mini",
  },
  anthropic: {
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    hostname: "api.anthropic.com",
    modelPlaceholder: "claude-sonnet-4-5",
  },
  google: {
    label: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    hostname: "generativelanguage.googleapis.com",
    modelPlaceholder: "gemini-2.5-flash",
  },
  custom: {
    label: "Custom",
    defaultBaseUrl: "",
    hostname: "",
    modelPlaceholder: "gpt-4o-mini",
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export const PRESET_ICON_IDS: Record<PresetId, ModelBrandIconId | null> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
  custom: null,
};

/** Reverse lookup: which preset does this baseUrl match? Falls back to "custom". */
export function presetFor(baseUrl: string): PresetId {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return "custom";
  }
  for (const id of PRESET_IDS) {
    if (PRESETS[id].hostname && PRESETS[id].hostname === host) return id;
  }
  return "custom";
}

export function providerIconForPreset(
  preset: PresetId,
): ModelBrandIconId | null {
  return PRESET_ICON_IDS[preset];
}

export function providerIdentityForBaseUrl(baseUrl: string): {
  iconId: ModelBrandIconId | null;
  label: string;
  preset: PresetId;
} {
  const preset = presetFor(baseUrl);
  return {
    iconId: providerIconForPreset(preset),
    label: PRESETS[preset].label,
    preset,
  };
}

export function modelIconForModel(model: string): ModelBrandIconId | null {
  const normalized = model.toLowerCase();

  if (/\bclaude\b/.test(normalized)) return "claude";
  if (normalized.includes("anthropic")) return "anthropic";
  if (normalized.includes("gemini")) return "gemini";
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("qwen") || /\bqwq\b/.test(normalized)) return "qwen";
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
  if (normalized.includes("llama") || normalized.includes("meta-")) return "meta";
  if (
    /\bgpt[-\d]/.test(normalized) ||
    normalized.includes("chatgpt") ||
    /\bo[1345](?:-|$)/.test(normalized)
  ) {
    return "openai";
  }

  return null;
}
