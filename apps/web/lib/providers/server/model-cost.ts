import "server-only";
import type { LanguageModelUsage } from "ai";
import type { ModelPricing } from "@/lib/model-config/schema";
import type { ProviderId } from "@/lib/providers/catalog";
import { catalogEntryFor } from "@/lib/providers/server/model-catalog";

export const MODEL_CATALOG_COST_SOURCE = "models.dev" as const;
export const MODEL_CONFIG_COST_SOURCE = "model_config" as const;

export type GenerationCostSource =
  | typeof MODEL_CATALOG_COST_SOURCE
  | typeof MODEL_CONFIG_COST_SOURCE;

export type EstimatedGenerationCost = {
  costSource: GenerationCostSource;
  inputCostNanoUsd: number;
  outputCostNanoUsd: number;
  cacheReadCostNanoUsd: number;
  cacheWriteCostNanoUsd: number;
  totalCostNanoUsd: number;
};

type PricingRates = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

type TokenBuckets = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export function estimateGenerationCost({
  ...params
}: {
  providerId: ProviderId;
  model: string;
  usage: LanguageModelUsage;
  pricing?: ModelPricing | null;
  cacheWriteTtl?: "5m" | "1h";
}): EstimatedGenerationCost | null {
  try {
    return estimateGenerationCostUnchecked(params);
  } catch (error) {
    console.error("[generation-cost]", error);
    return null;
  }
}

function estimateGenerationCostUnchecked({
  providerId,
  model,
  usage,
  pricing,
  cacheWriteTtl,
}: {
  providerId: ProviderId;
  model: string;
  usage: LanguageModelUsage;
  pricing?: ModelPricing | null;
  cacheWriteTtl?: "5m" | "1h";
}): EstimatedGenerationCost | null {
  const tokens = tokenBuckets(usage);
  if (!tokens) return null;

  const costSource =
    pricing === null || pricing === undefined
      ? MODEL_CATALOG_COST_SOURCE
      : MODEL_CONFIG_COST_SOURCE;
  const rates =
    pricing === null || pricing === undefined
      ? catalogRatesFor(providerId, model, tokens)
      : configuredPricingRates(pricing);
  if (!rates) return null;
  if (
    costSource === MODEL_CATALOG_COST_SOURCE &&
    cacheWriteTtl === "1h"
  ) {
    rates.cacheWrite = rates.input * 2;
  }

  const inputCostNanoUsd = costNanoUsd(tokens.input, rates.input);
  const outputCostNanoUsd = costNanoUsd(tokens.output, rates.output);
  const cacheReadCostNanoUsd = costNanoUsd(
    tokens.cacheRead,
    rates.cacheRead,
  );
  const cacheWriteCostNanoUsd = costNanoUsd(
    tokens.cacheWrite,
    rates.cacheWrite,
  );
  if (
    inputCostNanoUsd === null ||
    outputCostNanoUsd === null ||
    cacheReadCostNanoUsd === null ||
    cacheWriteCostNanoUsd === null
  ) {
    return null;
  }

  const totalCostNanoUsd =
    inputCostNanoUsd +
    outputCostNanoUsd +
    cacheReadCostNanoUsd +
    cacheWriteCostNanoUsd;
  if (!Number.isSafeInteger(totalCostNanoUsd)) return null;

  return {
    costSource,
    inputCostNanoUsd,
    outputCostNanoUsd,
    cacheReadCostNanoUsd,
    cacheWriteCostNanoUsd,
    totalCostNanoUsd,
  };
}

export function sumEstimatedGenerationCosts(
  costs: readonly EstimatedGenerationCost[],
): EstimatedGenerationCost | null {
  if (costs.length === 0) return null;
  const costSource = costs[0].costSource;
  if (costs.some((cost) => cost.costSource !== costSource)) return null;

  const total = costs.reduce<EstimatedGenerationCost>(
    (sum, cost) => ({
      costSource,
      inputCostNanoUsd: sum.inputCostNanoUsd + cost.inputCostNanoUsd,
      outputCostNanoUsd: sum.outputCostNanoUsd + cost.outputCostNanoUsd,
      cacheReadCostNanoUsd:
        sum.cacheReadCostNanoUsd + cost.cacheReadCostNanoUsd,
      cacheWriteCostNanoUsd:
        sum.cacheWriteCostNanoUsd + cost.cacheWriteCostNanoUsd,
      totalCostNanoUsd: sum.totalCostNanoUsd + cost.totalCostNanoUsd,
    }),
    {
      costSource,
      inputCostNanoUsd: 0,
      outputCostNanoUsd: 0,
      cacheReadCostNanoUsd: 0,
      cacheWriteCostNanoUsd: 0,
      totalCostNanoUsd: 0,
    },
  );

  return [
    total.inputCostNanoUsd,
    total.outputCostNanoUsd,
    total.cacheReadCostNanoUsd,
    total.cacheWriteCostNanoUsd,
    total.totalCostNanoUsd,
  ].every(Number.isSafeInteger)
    ? total
    : null;
}

function tokenBuckets(usage: LanguageModelUsage): TokenBuckets | null {
  const totalInput = tokenCount(usage.inputTokens);
  const output = tokenCount(usage.outputTokens);
  const cacheRead = optionalTokenCount(
    usage.inputTokenDetails?.cacheReadTokens,
  );
  const cacheWrite = optionalTokenCount(
    usage.inputTokenDetails?.cacheWriteTokens,
  );
  const reportedInput = optionalTokenCount(
    usage.inputTokenDetails?.noCacheTokens,
  );
  if (
    totalInput === null ||
    output === null ||
    cacheRead === null ||
    cacheWrite === null ||
    reportedInput === null
  ) {
    return null;
  }

  return {
    input:
      reportedInput ??
      Math.max(totalInput - (cacheRead ?? 0) - (cacheWrite ?? 0), 0),
    output,
    cacheRead: cacheRead ?? 0,
    cacheWrite: cacheWrite ?? 0,
  };
}

function catalogRatesFor(
  providerId: ProviderId,
  model: string,
  tokens: TokenBuckets,
): PricingRates | null {
  const catalogCost = catalogEntryFor(providerId, model)?.cost;
  return catalogCost
    ? catalogPricingRates(catalogCost, totalInputTokens(tokens))
    : null;
}

function configuredPricingRates(pricing: ModelPricing): PricingRates | null {
  const input = rate(pricing.input);
  const output = rate(pricing.output);
  const cacheRead = rate(pricing.cacheRead);
  const cacheWrite = rate(pricing.cacheWrite);
  return input === null ||
    output === null ||
    cacheRead === null ||
    cacheWrite === null
    ? null
    : { input, output, cacheRead, cacheWrite };
}

function catalogPricingRates(
  rawCost: Readonly<Record<string, unknown>>,
  inputTokens: number,
): PricingRates | null {
  const input = rate(rawCost.input);
  const output = rate(rawCost.output);
  if (input === null || output === null) return null;

  let applied: PricingRates = {
    input,
    output,
    cacheRead: rate(rawCost.cache_read) ?? input,
    cacheWrite: rate(rawCost.cache_write) ?? input,
  };

  const contextTiers = Array.isArray(rawCost.tiers)
    ? rawCost.tiers
        .map(readContextTier)
        .filter((tier): tier is ContextTier => tier !== null)
        .sort((left, right) => left.size - right.size)
    : [];
  if (contextTiers.length > 0) {
    for (const tier of contextTiers) {
      if (inputTokens > tier.size) {
        applied = overlayRates(applied, tier.rates);
      }
    }
    return applied;
  }

  if (inputTokens > 200_000 && isRecord(rawCost.context_over_200k)) {
    applied = overlayRates(applied, rawCost.context_over_200k);
  }
  return applied;
}

type ContextTier = {
  size: number;
  rates: Readonly<Record<string, unknown>>;
};

function readContextTier(value: unknown): ContextTier | null {
  if (!isRecord(value) || !isRecord(value.tier)) return null;
  if (value.tier.type !== "context") return null;
  const size = tokenCount(value.tier.size);
  return size === null ? null : { size, rates: value };
}

function overlayRates(
  base: PricingRates,
  values: Readonly<Record<string, unknown>>,
): PricingRates {
  return {
    input: rate(values.input) ?? base.input,
    output: rate(values.output) ?? base.output,
    cacheRead: rate(values.cache_read) ?? base.cacheRead,
    cacheWrite: rate(values.cache_write) ?? base.cacheWrite,
  };
}

function totalInputTokens(tokens: TokenBuckets): number {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite;
}

function costNanoUsd(tokens: number, usdPerMillion: number): number | null {
  const value = Math.round(tokens * usdPerMillion * 1_000);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function tokenCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function optionalTokenCount(value: unknown): number | null | undefined {
  return value === undefined ? undefined : tokenCount(value);
}

function rate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
