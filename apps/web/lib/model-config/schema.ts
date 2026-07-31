import { z } from "zod";
import type { ModelCapabilities } from "@overtchat/shared";
import {
  API_FORMAT_IDS,
  PROVIDERS,
  PROVIDER_IDS,
  type ApiFormat,
  type ProviderId,
} from "@/lib/providers/catalog";

export type { PublicModelConfig } from "@overtchat/shared";

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Admin-facing model config DTO. Includes secrets and provider options for editing. */
export interface AdminModelConfig {
  id: string;
  label: string;
  providerId: ProviderId;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  pricing: ModelPricing | null;
  /** Explicit administrator override. */
  contextWindow: number | null;
  /** Last limit reported by model discovery. */
  discoveredContextWindow: number | null;
  /** Last capabilities explicitly reported by model discovery. */
  discoveredCapabilities: ModelCapabilities | null;
  /** Effective override, discovered, or catalog value for admin UI guidance. */
  resolvedContextWindow?: number;
  /** Runtime fields with exact-catalog fallback for admin UI guidance. */
  resolvedCapabilities?: ModelCapabilities;
  systemPrompt: string | null;
  providerOptions: Record<string, unknown> | null;
  toolCallingEnabled: boolean;
  enabled: boolean;
  sortOrder: number;
}

const EndpointSchema = z
  .string()
  .trim()
  .min(1, "Endpoint is required")
  .refine(isHttpEndpoint, "Endpoint must be an absolute HTTP or HTTPS URL")
  .transform((value) => value.replace(/\/+$/, ""));

/**
 * Structural model-config validation shared by HTTP routes and the settings UI.
 * Provider-specific semantics are validated by the server registry before save.
 */
const ProviderConnectionObject = z.object({
  providerId: z.enum(PROVIDER_IDS),
  apiFormat: z.enum(API_FORMAT_IDS),
  baseUrl: EndpointSchema,
  apiKey: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
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
  toolCallingEnabled: z
    .boolean()
    .nullish()
    .transform((value) => value ?? true),
};

const ModelCapabilitiesSchema = z
  .object({
    maxInputTokens: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    inputModalities: z.array(z.string().trim().min(1)).optional(),
    outputModalities: z.array(z.string().trim().min(1)).optional(),
    attachment: z.boolean().optional(),
    toolCalling: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    structuredOutput: z.boolean().optional(),
    temperature: z.boolean().optional(),
  })
  .transform((value) => (Object.keys(value).length > 0 ? value : null));

export const ModelPricingSchema = z.object({
  input: z.number().finite().nonnegative(),
  output: z.number().finite().nonnegative(),
  cacheRead: z.number().finite().nonnegative(),
  cacheWrite: z.number().finite().nonnegative(),
});

export const RuntimeModelConfigSchema = ProviderConnectionObject.extend(
  RuntimeModelFields,
).superRefine(validateProviderConnection);

export const ModelConfigSchema = ProviderConnectionObject.extend({
  label: z.string().trim().min(1, "Display name is required"),
  ...RuntimeModelFields,
  pricing: ModelPricingSchema.nullish().transform((value) => value ?? null),
  contextWindow: z
    .number()
    .int()
    .positive("Context window must be a positive integer")
    .nullish()
    .transform((value) => value ?? null),
  discoveredContextWindow: z
    .number()
    .int()
    .positive("Detected context window must be a positive integer")
    .nullish()
    .transform((value) => value ?? null),
  discoveredCapabilities: ModelCapabilitiesSchema.nullish().transform(
    (value) => value ?? null,
  ),
  systemPrompt: z
    .string()
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    }),
  enabled: z
    .boolean()
    .nullish()
    .transform((value) => value ?? true),
  sortOrder: z
    .number()
    .int()
    .nullish()
    .transform((value) => value ?? 0),
}).superRefine(validateProviderConnection);

export type ModelConfigInput = z.infer<typeof ModelConfigSchema>;

export interface ModelDiscoveryInput {
  providerId: ProviderId;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey?: string | null;
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

function isHttpEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === "http:" || endpoint.protocol === "https:";
  } catch {
    return false;
  }
}
