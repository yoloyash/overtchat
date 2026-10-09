import { z } from "zod";
import { REASONING_EFFORTS, type ModelCapabilities } from "@overtchat/shared";
import {
  API_FORMAT_IDS,
  PROVIDERS,
  PROVIDER_IDS,
  type ApiFormat,
  type ProviderId,
} from "@/lib/providers/catalog";

export type { PublicModelConfig } from "@overtchat/shared";

/**
 * Who a model's connection belongs to. `shared`: one base URL and key for
 * everyone. `user`: each user has their own key (and optionally base URL),
 * set by an administrator; the model is hidden from users without one.
 */
export const MODEL_CREDENTIAL_SCOPES = ["shared", "user"] as const;
export type ModelCredentialScope = (typeof MODEL_CREDENTIAL_SCOPES)[number];

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CatalogModelPricing extends ModelPricing {
  tiered: boolean;
}

/** Admin-facing model config DTO. Includes secrets and provider options for editing. */
export interface AdminModelConfig {
  modelType: "chat" | "image";
  id: string;
  label: string;
  providerId: ProviderId;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey: string | null;
  /** Last model configuration update, in milliseconds since epoch. */
  updatedAt: number;
  model: string;
  pricing: ModelPricing | null;
  /** Exact models.dev base rates for admin UI guidance. */
  catalogPricing: CatalogModelPricing | null;
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
  taskModel: boolean;
  credentialScope: ModelCredentialScope;
  sortOrder: number;
}

/** Admin-facing view of one user's credential. The key itself is write-only. */
export interface AdminModelUserCredential {
  userId: string;
  hasApiKey: boolean;
  baseUrl: string | null;
  updatedAt: number;
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
    reasoningControls: z
      .object({
        toggle: z.boolean(),
        defaultLevel: z.enum(["off", "on", ...REASONING_EFFORTS]),
        efforts: z.array(z.enum(REASONING_EFFORTS)).optional(),
      })
      .optional(),
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
  modelType: z.enum(["chat", "image"]).default("chat"),
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
  // Omitted means "unchanged" on update (and `shared` on create), so clients
  // that predate per-user credentials can't silently reset a model's scope.
  credentialScope: z.enum(MODEL_CREDENTIAL_SCOPES).optional(),
})
  .superRefine((value, context) => {
    // Per-user models take each user's key; the model's own key is optional.
    validateProviderConnection(value, context, {
      apiKeyOptional: value.credentialScope === "user",
    });
    if (value.modelType === "image" && value.credentialScope === "user") {
      context.addIssue({
        code: "custom",
        path: ["credentialScope"],
        message: "Image models use a shared connection.",
      });
    }
    if (value.modelType === "image") {
      if (value.providerId !== "openai" && value.providerId !== "google") {
        context.addIssue({
          code: "custom",
          path: ["providerId"],
          message: "Image models support OpenAI and Google Gemini.",
        });
      }
      if (!isHttpEndpoint(value.baseUrl)) return;
      const endpoint = new URL(value.baseUrl);
      if (
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      ) {
        context.addIssue({
          code: "custom",
          path: ["baseUrl"],
          message:
            "Use an endpoint without credentials, query parameters, or fragments.",
        });
      }
    }
  })
  .transform((value) =>
    value.modelType === "image"
      ? {
          ...value,
          toolCallingEnabled: false,
          systemPrompt: null,
          providerOptions: null,
          contextWindow: null,
          discoveredContextWindow: null,
          discoveredCapabilities: null,
          pricing: null,
        }
      : value,
  );

export type ModelConfigInput = z.infer<typeof ModelConfigSchema>;

/**
 * The connection to validate a model config with before save. A per-user model
 * may have no key of its own (each user brings one), so a placeholder stands
 * in for providers that require one; it is never stored or sent.
 */
export function connectionForValidation(input: ModelConfigInput): ModelConfigInput {
  return input.credentialScope === "user" && !input.apiKey
    ? { ...input, apiKey: "per-user-credential" }
    : input;
}

/**
 * An administrator's write of one user's credential for a per-user model.
 * An omitted `apiKey` keeps the stored one; `null` or "" removes it.
 */
export const ModelUserCredentialSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value === undefined ? undefined : value || null)),
  baseUrl: EndpointSchema.nullish().transform((value) => value ?? null),
});

export type ModelUserCredentialInput = z.infer<typeof ModelUserCredentialSchema>;
/** The request body clients send (omit `apiKey` to keep the stored key). */
export type ModelUserCredentialWrite = z.input<typeof ModelUserCredentialSchema>;

export interface ModelDiscoveryInput {
  providerId: ProviderId;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey?: string | null;
}

function validateProviderConnection(
  value: z.infer<typeof ProviderConnectionObject>,
  context: z.RefinementCtx,
  { apiKeyOptional = false }: { apiKeyOptional?: boolean } = {},
) {
  const provider = PROVIDERS[value.providerId];
  if (provider.requiresApiKey && !value.apiKey && !apiKeyOptional) {
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
