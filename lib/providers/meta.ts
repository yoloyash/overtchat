/** Wire-protocol identifier — selects which SDK + /models endpoint shape to use. */
export type ProviderId = "openai-compatible" | "anthropic" | "google";

/** UX preset shown in the dialog dropdown and the picker group headers. */
export type PresetId = "openai" | "anthropic" | "google" | "custom";

export interface Preset {
  label: string;
  provider: ProviderId;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  modelPlaceholder: string;
}

export const PRESETS: Record<PresetId, Preset> = {
  openai: {
    label: "OpenAI",
    provider: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
    modelPlaceholder: "gpt-4o-mini",
  },
  anthropic: {
    label: "Anthropic",
    provider: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    requiresApiKey: true,
    modelPlaceholder: "claude-sonnet-4-5",
  },
  google: {
    label: "Google Gemini",
    provider: "google",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    requiresApiKey: true,
    modelPlaceholder: "gemini-2.5-flash",
  },
  custom: {
    label: "Custom",
    provider: "openai-compatible",
    defaultBaseUrl: "",
    requiresApiKey: false,
    modelPlaceholder: "gpt-4o-mini",
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

/**
 * Infer a preset from a stored (provider, baseUrl) pair. Used both server-side
 * (to label `PublicModelConfig` for the picker) and client-side (to seed the
 * dialog when editing an existing config).
 */
export function presetFor(provider: ProviderId, baseUrl: string): PresetId {
  if (provider === "anthropic") return "anthropic";
  if (provider === "google") return "google";
  // openai-compatible — split by hostname.
  return isOpenAIHost(baseUrl) ? "openai" : "custom";
}

function isOpenAIHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}
