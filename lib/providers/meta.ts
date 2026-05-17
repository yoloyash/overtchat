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
