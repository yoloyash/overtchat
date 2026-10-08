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
  usage: UsageTotals;
};
