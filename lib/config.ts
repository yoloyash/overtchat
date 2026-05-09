import { useLocalStorage } from "@/lib/useLocalStorage";

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const CONFIG_KEY = "overtchat_config";
const DEFAULT_CONFIG: ApiConfig = { baseUrl: "", apiKey: "", model: "" };

export function useConfig(): [ApiConfig, (next: ApiConfig) => void] {
  return useLocalStorage<ApiConfig>(CONFIG_KEY, DEFAULT_CONFIG);
}

export async function fetchModels(
  config: Pick<ApiConfig, "baseUrl" | "apiKey">,
): Promise<string[]> {
  const res = await fetch(config.baseUrl.replace(/\/$/, "") + "/models", {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id).sort();
}
