import type { UsageTotals } from "@/lib/usage/types";

const NANO_USD_PER_USD = 1_000_000_000;
const MINIMUM_VISIBLE_USD = 0.000001;

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
  if (usd > 0 && usd < MINIMUM_VISIBLE_USD) return "<$0.000001";

  const maximumFractionDigits = usd < 0.01 ? 6 : usd < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(usd);
}
