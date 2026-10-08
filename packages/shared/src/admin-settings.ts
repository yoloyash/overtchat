import type { ModelCapabilities } from "./models";
import type { ProviderId, ApiFormat } from "./provider-catalog";

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
