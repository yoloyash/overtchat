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
  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl: config.baseUrl, apiKey: config.apiKey }),
  });
  const json = (await res.json()) as { models?: string[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.models ?? [];
}
