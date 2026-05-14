import { useLocalStorage } from "@/lib/useLocalStorage";

/** Public-facing model config DTO. `apiKey` is intentionally omitted — it never leaves the server. */
export interface PublicModelConfig {
  id: string;
  label: string;
  model: string;
  hasExtraBody: boolean;
}

/** Admin-facing model config DTO. Includes `apiKey` + `extraBody` for editing. */
export interface AdminModelConfig {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  systemPrompt: string | null;
  extraBody: Record<string, unknown> | null;
  sortOrder: number;
}

export interface ModelConfigInput {
  label: string;
  baseUrl: string;
  apiKey?: string | null;
  model: string;
  systemPrompt?: string | null;
  extraBody?: Record<string, unknown> | null;
  sortOrder?: number;
}

const SELECTED_MODEL_KEY = "overtchat_selected_model";

export function useSelectedModel(): [string, (id: string) => void] {
  return useLocalStorage<string>(SELECTED_MODEL_KEY, "");
}

export async function fetchModelsForEndpoint(
  baseUrl: string,
  apiKey?: string | null,
): Promise<string[]> {
  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl, apiKey: apiKey ?? "" }),
  });
  const json = (await res.json()) as { models?: string[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.models ?? [];
}
