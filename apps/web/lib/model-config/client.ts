"use client";

import type { ModelCapabilities } from "@overtchat/shared";
import { useLocalStorage } from "@/lib/useLocalStorage";
import type {
  CatalogModelPricing,
  ModelDiscoveryInput,
} from "@/lib/model-config/schema";

const SELECTED_MODEL_KEY = "overtchat_selected_model";

export interface AvailableModel {
  id: string;
  /** Limit reported by the provider endpoint. */
  contextWindow?: number;
  /** Exact vendored-catalog fallback for UI guidance. */
  catalogContextWindow?: number;
  /** Capabilities explicitly reported by the configured endpoint. */
  capabilities?: ModelCapabilities;
  /** Exact vendored-catalog fallback for UI guidance. */
  catalogCapabilities?: ModelCapabilities;
  /** Exact vendored-catalog base rates for UI guidance. */
  catalogPricing?: CatalogModelPricing;
}

export function useSelectedModel(): [string, (id: string) => void] {
  return useLocalStorage<string>(SELECTED_MODEL_KEY, "");
}

export async function fetchModelsForProvider(
  input: ModelDiscoveryInput,
): Promise<AvailableModel[]> {
  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as { models?: unknown; error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  if (!Array.isArray(json.models)) return [];
  return json.models.flatMap((value): AvailableModel[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id) return [];
    const contextWindow =
      typeof record.contextWindow === "number" &&
      Number.isInteger(record.contextWindow) &&
      record.contextWindow > 0
        ? record.contextWindow
        : undefined;
    const catalogContextWindow =
      typeof record.catalogContextWindow === "number" &&
      Number.isInteger(record.catalogContextWindow) &&
      record.catalogContextWindow > 0
        ? record.catalogContextWindow
        : undefined;
    const capabilities = readCapabilities(record.capabilities);
    const catalogCapabilities = readCapabilities(record.catalogCapabilities);
    const catalogPricing = readCatalogPricing(record.catalogPricing);
    return [
      {
        id: record.id,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(catalogContextWindow === undefined
          ? {}
          : { catalogContextWindow }),
        ...(capabilities === undefined ? {} : { capabilities }),
        ...(catalogCapabilities === undefined
          ? {}
          : { catalogCapabilities }),
        ...(catalogPricing === undefined ? {} : { catalogPricing }),
      },
    ];
  });
}

function readCatalogPricing(value: unknown): CatalogModelPricing | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const pricingKeys = [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
  ] as const;
  if (
    typeof record.tiered !== "boolean" ||
    pricingKeys.some(
      (key) =>
        typeof record[key] !== "number" ||
        !Number.isFinite(record[key]) ||
        (record[key] as number) < 0,
    )
  ) {
    return undefined;
  }
  return {
    input: record.input as number,
    output: record.output as number,
    cacheRead: record.cacheRead as number,
    cacheWrite: record.cacheWrite as number,
    tiered: record.tiered,
  };
}

function readCapabilities(value: unknown): ModelCapabilities | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const result: ModelCapabilities = {};
  for (const key of ["maxInputTokens", "maxOutputTokens"] as const) {
    const candidate = record[key];
    if (
      typeof candidate === "number" &&
      Number.isSafeInteger(candidate) &&
      candidate > 0
    ) {
      result[key] = candidate;
    }
  }
  for (const key of ["inputModalities", "outputModalities"] as const) {
    const candidate = record[key];
    if (!Array.isArray(candidate)) continue;
    const values = candidate.flatMap((item) =>
      typeof item === "string" && item.trim() ? [item.trim()] : [],
    );
    if (values.length > 0) result[key] = [...new Set(values)];
  }
  for (const key of [
    "attachment",
    "toolCalling",
    "reasoning",
    "structuredOutput",
    "temperature",
  ] as const) {
    const candidate = record[key];
    if (typeof candidate === "boolean") result[key] = candidate;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
