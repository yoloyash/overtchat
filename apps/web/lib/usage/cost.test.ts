import { describe, expect, it } from "vitest";
import { combinePricedUsage, type UsageTotals } from "@overtchat/shared/usage";
import { formatNanoUsd, getCostCoverage } from "./cost";

function totals(
  generations: number,
  pricedGenerations: number,
  totalCostNanoUsd: number,
): UsageTotals {
  return {
    generations,
    pricedGenerations,
    inputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    inputCostNanoUsd: 0,
    outputCostNanoUsd: 0,
    cacheReadCostNanoUsd: 0,
    cacheWriteCostNanoUsd: 0,
    totalCostNanoUsd,
  };
}

describe("session cost formatting", () => {
  it("matches Pi's terse three-decimal session format", () => {
    expect(formatNanoUsd(0)).toBe("$0.000");
    expect(formatNanoUsd(55_900_000)).toBe("$0.056");
    expect(formatNanoUsd(1_500_000_000)).toBe("$1.500");
  });

  it("distinguishes complete, partial, and unavailable pricing", () => {
    expect(
      getCostCoverage({ generations: 2, pricedGenerations: 2 }),
    ).toBe("complete");
    expect(
      getCostCoverage({ generations: 2, pricedGenerations: 1 }),
    ).toBe("partial");
    expect(
      getCostCoverage({ generations: 2, pricedGenerations: 0 }),
    ).toBe("unavailable");
  });
});

describe("combined chat and image cost", () => {
  it("adds priced groups and marks any unpriced generation in them", () => {
    expect(
      combinePricedUsage([totals(2, 2, 4_000), totals(1, 1, 77_405_000)]),
    ).toEqual({ totalCostNanoUsd: 77_409_000, partial: false });
    expect(
      combinePricedUsage([totals(2, 2, 4_000), totals(2, 1, 77_405_000)]),
    ).toEqual({ totalCostNanoUsd: 77_409_000, partial: true });
  });

  it("leaves out untracked groups such as local models and older servers", () => {
    expect(
      combinePricedUsage([totals(3, 0, 0), totals(1, 1, 77_405_000)]),
    ).toEqual({ totalCostNanoUsd: 77_405_000, partial: false });
    expect(combinePricedUsage([totals(2, 1, 4_000), undefined])).toEqual({
      totalCostNanoUsd: 4_000,
      partial: true,
    });
    expect(combinePricedUsage([totals(3, 0, 0), undefined])).toBeUndefined();
  });
});
