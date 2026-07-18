"use client";

import { useLocalStorage } from "@/lib/useLocalStorage";
import type { ModelDiscoveryInput } from "@/lib/model-config/schema";

const SELECTED_MODEL_KEY = "overtchat_selected_model";

export function useSelectedModel(): [string, (id: string) => void] {
  return useLocalStorage<string>(SELECTED_MODEL_KEY, "");
}

export async function fetchModelsForProvider(
  input: ModelDiscoveryInput,
): Promise<string[]> {
  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as { models?: string[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.models ?? [];
}
