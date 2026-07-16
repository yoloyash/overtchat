import { z } from "zod";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  API_FORMAT_IDS,
  PROVIDERS,
  PROVIDER_IDS,
  type ApiFormat,
  type ProviderId,
} from "@/lib/providers/catalog";
export type { PublicModelConfig } from "@overtchat/shared";

/** Admin-facing model config DTO. Includes secrets and provider options for editing. */
export interface AdminModelConfig {
  id: string;
  label: string;
  providerId: ProviderId;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  systemPrompt: string | null;
  providerOptions: Record<string, unknown> | null;
  enabled: boolean;
  sortOrder: number;
}

/**
 * Single source of truth for model-config input — used by the form and by the
 * POST/PATCH API routes. Provider identity and API format are explicit; URLs
 * are normalized and empty optionals become null.
 */
const ProviderConnectionObject = z.object({
  providerId: z.enum(PROVIDER_IDS),
  apiFormat: z.enum(API_FORMAT_IDS),
  baseUrl: z
    .string()
    .trim()
    .min(1, "Endpoint is required")
    .transform((value) => value.replace(/\/+$/, "")),
  apiKey: z.string().nullish().transform((value) => value ?? null),
});

export const ProviderConnectionSchema = ProviderConnectionObject.superRefine(
  validateProviderConnection,
);

const RuntimeModelFields = {
  model: z.string().trim().min(1, "Model is required"),
  providerOptions: z
    .record(z.string(), z.unknown())
    .nullish()
    .transform((value) => value ?? null),
};

export const RuntimeModelConfigSchema = ProviderConnectionObject.extend(
  RuntimeModelFields,
).superRefine(validateProviderConnection);

export const ModelConfigSchema = ProviderConnectionObject.extend({
  label: z.string().trim().min(1, "Display name is required"),
  ...RuntimeModelFields,
  systemPrompt: z
    .string()
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    }),
  enabled: z.boolean().nullish().transform((value) => value ?? true),
  sortOrder: z.number().int().nullish().transform((value) => value ?? 0),
}).superRefine(validateProviderConnection);

export type ModelConfigInput = z.infer<typeof ModelConfigSchema>;

const SELECTED_MODEL_KEY = "overtchat_selected_model";

export function useSelectedModel(): [string, (id: string) => void] {
  return useLocalStorage<string>(SELECTED_MODEL_KEY, "");
}

export interface ModelDiscoveryInput {
  providerId: ProviderId;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey?: string | null;
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

function validateProviderConnection(
  value: z.infer<typeof ProviderConnectionObject>,
  context: z.RefinementCtx,
) {
  const provider = PROVIDERS[value.providerId];
  if (provider.requiresApiKey && !value.apiKey) {
    context.addIssue({
      code: "custom",
      path: ["apiKey"],
      message: `${provider.label} requires an API key`,
    });
  }
  if (value.providerId === "custom" && value.apiFormat === "auto") {
    context.addIssue({
      code: "custom",
      path: ["apiFormat"],
      message: "Custom providers require an explicit API format",
    });
  }
  if (value.providerId !== "custom" && value.apiFormat !== "auto") {
    context.addIssue({
      code: "custom",
      path: ["apiFormat"],
      message: `${provider.label} manages its API format automatically`,
    });
  }
}
