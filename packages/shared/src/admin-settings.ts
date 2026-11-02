import type { ModelCapabilities, ModelReasoningLevel } from "./models";
import type { ProviderId, ApiFormat } from "./provider-catalog";

export type ReasoningRequestFields = Record<string, unknown>;

/**
 * Administrator-declared thinking levels for an OpenAI-compatible local model.
 * Each level's fields are merged into the Chat Completions body as a JSON Merge
 * Patch (RFC 7396). An empty `requests` object hides the thinking selector.
 */
export interface ReasoningOverride {
  /** Level the server applies when no thinking field is sent. */
  defaultLevel?: ModelReasoningLevel;
  requests: Partial<Record<ModelReasoningLevel, ReasoningRequestFields>>;
}

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CatalogModelPricing extends ModelPricing {
  tiered: boolean;
}

/**
 * Who a model's connection belongs to. `shared`: one base URL and key for
 * everyone. `user`: each person may have their own key and base URL, set by
 * an administrator; whatever they have not set falls back to the model's own.
 */
export const MODEL_CREDENTIAL_SCOPES = ["shared", "user"] as const;
export type ModelCredentialScope = (typeof MODEL_CREDENTIAL_SCOPES)[number];

/** Admin-facing model config DTO. Includes secrets and provider options for editing. */
export interface AdminModelConfig {
  modelType: "chat" | "image";
  id: string;
  label: string;
  providerId: ProviderId;
  /** Label for clients that do not know `providerId`. Absent on older servers. */
  displayProvider?: string;
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
  /** Null follows the catalog or saved detection; survives re-detection. */
  reasoningOverride: ReasoningOverride | null;
  systemPrompt: string | null;
  providerOptions: Record<string, unknown> | null;
  toolCallingEnabled: boolean;
  enabled: boolean;
  taskModel: boolean;
  /** Absent on servers that predate per-user credentials; treat as `shared`. */
  credentialScope?: ModelCredentialScope;
  sortOrder: number;
}

export interface SettingsUser {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  createdAt: string | Date;
}
export type CapabilityId = "search" | "tts" | "stt";
export interface AdminServerCapability {
  id: CapabilityId;
  provider: string;
  bundledInstalled: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  apiKeySet: boolean;
  model: string | null;
  voice: string | null;
  configured: boolean;
}
export interface AvailableMcpServer {
  id: string;
  name: string;
  enabled: boolean;
}
