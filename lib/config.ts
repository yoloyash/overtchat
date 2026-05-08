export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const CONFIG_KEY = "overtchat_config";

export function loadConfig(): ApiConfig {
  if (typeof window === "undefined") return { baseUrl: "", apiKey: "", model: "" };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : { baseUrl: "", apiKey: "", model: "" };
  } catch {
    return { baseUrl: "", apiKey: "", model: "" };
  }
}

export function saveConfig(config: ApiConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}
