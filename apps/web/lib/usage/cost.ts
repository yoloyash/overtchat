import type { UsageTotals } from "@/lib/usage/types";

const NANO_USD_PER_USD = 1_000_000_000;

export type CostCoverage = "complete" | "partial" | "unavailable";

export function getCostCoverage(
  totals: Pick<UsageTotals, "generations" | "pricedGenerations">,
): CostCoverage {
  if (totals.pricedGenerations <= 0) return "unavailable";
  return totals.pricedGenerations < totals.generations
    ? "partial"
    : "complete";
}

export function formatNanoUsd(nanoUsd: number): string {
  const usd = Math.max(0, nanoUsd) / NANO_USD_PER_USD;
  return `$${usd.toFixed(3)}`;
}
