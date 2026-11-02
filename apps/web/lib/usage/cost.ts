import type { UsageTotals } from "@/lib/usage/types";

export { formatNanoUsd } from "@overtchat/shared/usage";

export type CostCoverage = "complete" | "partial" | "unavailable";

export function getCostCoverage(
  totals: Pick<UsageTotals, "generations" | "pricedGenerations">,
): CostCoverage {
  if (totals.pricedGenerations <= 0) return "unavailable";
  return totals.pricedGenerations < totals.generations
    ? "partial"
    : "complete";
}
