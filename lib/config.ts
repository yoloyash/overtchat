import { z } from "zod";
import { useLocalStorage } from "@/lib/useLocalStorage";

/** Public-facing model config DTO. `apiKey` is intentionally omitted — it never leaves the server. */
export interface PublicModelConfig {
  id: string;
  label: string;
  /** Display label for the underlying provider, e.g. "OpenAI", "Anthropic", "Custom". */
  displayProvider: string;
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
  enabled: boolean;
  sortOrder: number;
}

/**
 * Single source of truth for model-config input — used by the form and by the
 * POST/PATCH API routes. Trims whitespace, strips trailing slash on baseUrl,
 * and normalizes empty optionals to null.
 */
export const ModelConfigSchema = z.object({
  label: z.string().trim().min(1, "Display name is required"),
  baseUrl: z
    .string()
    .trim()
    .min(1, "Endpoint is required")
    .transform((s) => s.replace(/\/$/, "")),
  apiKey: z.string().nullish().transform((v) => v ?? null),
  model: z.string().trim().min(1, "Model is required"),
  systemPrompt: z
    .string()
    .nullish()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : null;
    }),
  extraBody: z
    .record(z.string(), z.unknown())
    .nullish()
    .transform((v) => v ?? null),
  enabled: z.boolean().nullish().transform((v) => v ?? true),
  sortOrder: z.number().int().nullish().transform((v) => v ?? 0),
});

export type ModelConfigInput = z.infer<typeof ModelConfigSchema>;

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
