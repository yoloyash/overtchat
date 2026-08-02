import "server-only";
import type { ModelCapabilities } from "@overtchat/shared";
import type { CatalogModelPricing } from "@/lib/model-config/schema";
import type { ProviderId } from "@/lib/providers/catalog";
import catalogJson from "@/lib/providers/server/model-catalog.json";

export interface ModelCatalogEntry {
  context?: number;
  input?: number;
  output?: number;
  cost?: Readonly<Record<string, unknown>>;
  input_modalities?: readonly string[];
  output_modalities?: readonly string[];
  attachment?: boolean;
  tool_call?: boolean;
  reasoning?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
}

type ModelCatalog = Partial<
  Record<ProviderId, Record<string, ModelCatalogEntry>>
>;

const catalog = catalogJson as ModelCatalog;

/**
 * Looks up only the exact configured provider and wire model ID. Model aliases,
 * prefixes, and families are intentionally not inferred.
 */
export function catalogEntryFor(
  providerId: ProviderId,
  model: string,
): ModelCatalogEntry | undefined {
  return catalog[providerId]?.[model];
}

export function catalogContextWindowFor(
  providerId: ProviderId,
  model: string,
): number | undefined {
  return catalogEntryFor(providerId, model)?.context;
}

export function catalogPricingFor(
  providerId: ProviderId,
  model: string,
): CatalogModelPricing | undefined {
  const cost = catalogEntryFor(providerId, model)?.cost;
  if (!cost) return undefined;

  const input = catalogRate(cost.input);
  const output = catalogRate(cost.output);
  if (input === undefined || output === undefined) return undefined;

  return {
    input,
    output,
    cacheRead: catalogRate(cost.cache_read) ?? input,
    cacheWrite: catalogRate(cost.cache_write) ?? input,
    tiered:
      (Array.isArray(cost.tiers) && cost.tiers.length > 0) ||
      isRecord(cost.context_over_200k),
  };
}

export function catalogCapabilitiesFor(
  providerId: ProviderId,
  model: string,
): ModelCapabilities | undefined {
  const entry = catalogEntryFor(providerId, model);
  if (!entry) return undefined;
  return compactCapabilities({
    maxInputTokens: entry.input,
    maxOutputTokens: entry.output,
    inputModalities: entry.input_modalities
      ? [...entry.input_modalities]
      : undefined,
    outputModalities: entry.output_modalities
      ? [...entry.output_modalities]
      : undefined,
    attachment: entry.attachment,
    toolCalling: entry.tool_call,
    reasoning: entry.reasoning,
    structuredOutput: entry.structured_output,
    temperature: entry.temperature,
  });
}

/**
 * Runtime self-reports win field-by-field over the exact catalog entry.
 * Missing runtime fields remain eligible for catalog fallback.
 */
export function resolveModelCapabilities(
  discovered: ModelCapabilities | null | undefined,
  providerId: ProviderId,
  model: string,
): ModelCapabilities | undefined {
  const fallback = catalogCapabilitiesFor(providerId, model);
  return compactCapabilities({ ...fallback, ...discovered });
}

/**
 * Resolves explicit override, persisted runtime discovery, then the vendored
 * catalog. Invalid persisted data is ignored defensively; schema validation
 * should normally prevent it.
 */
export function resolveModelContextWindow(
  overrideContextWindow: number | null | undefined,
  discoveredContextWindow: number | null | undefined,
  providerId: ProviderId,
  model: string,
): number | undefined {
  for (const candidate of [overrideContextWindow, discoveredContextWindow]) {
    if (
      typeof candidate === "number" &&
      Number.isSafeInteger(candidate) &&
      candidate > 0
    ) {
      return candidate;
    }
  }
  return catalogContextWindowFor(providerId, model);
}

function catalogRate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function compactCapabilities(
  capabilities: ModelCapabilities,
): ModelCapabilities | undefined {
  const defined = Object.fromEntries(
    Object.entries(capabilities).filter(([, value]) => value !== undefined),
  ) as ModelCapabilities;
  return Object.keys(defined).length > 0 ? defined : undefined;
}
