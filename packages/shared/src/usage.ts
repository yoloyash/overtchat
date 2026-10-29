export type UsageTotals = {
  generations: number;
  pricedGenerations: number;
  inputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  inputCostNanoUsd: number;
  outputCostNanoUsd: number;
  cacheReadCostNanoUsd: number;
  cacheWriteCostNanoUsd: number;
  totalCostNanoUsd: number;
};

export type ChatUsageResponse = {
  /** Chat model generations. */
  usage: UsageTotals;
  /** Image tool operations. Servers before image usage tracking omit it. */
  images?: UsageTotals;
};

export type CombinedCost = {
  totalCostNanoUsd: number;
  /** Some generations in a priced group have no price. */
  partial: boolean;
};

/**
 * Totals the cost of usage groups that have any price. A group with no priced
 * generation, such as a local model, is not tracked and stays out of the total.
 */
export function combinePricedUsage(
  groups: readonly (UsageTotals | undefined)[],
): CombinedCost | undefined {
  const priced = groups.filter(
    (group): group is UsageTotals => (group?.pricedGenerations ?? 0) > 0,
  );
  if (priced.length === 0) return undefined;
  return {
    totalCostNanoUsd: priced.reduce(
      (sum, group) => sum + group.totalCostNanoUsd,
      0,
    ),
    partial: priced.some(
      (group) => group.pricedGenerations < group.generations,
    ),
  };
}
