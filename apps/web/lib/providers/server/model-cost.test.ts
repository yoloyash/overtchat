import { describe, expect, it, vi } from "vitest";
import type { ProviderId } from "@/lib/providers/catalog";
import catalogJson from "./model-catalog.json";
import * as modelCatalog from "./model-catalog";

vi.mock("server-only", () => ({}));

import {
  estimateGenerationCost,
  sumEstimatedGenerationCosts,
} from "./model-cost";

function usage({
  input,
  output,
  noCache,
  cacheRead,
  cacheWrite,
}: {
  input?: number;
  output?: number;
  noCache?: number;
  cacheRead?: number;
  cacheWrite?: number;
}) {
  return {
    inputTokens: input,
    inputTokenDetails: {
      noCacheTokens: noCache,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    },
    outputTokens: output,
    outputTokenDetails: {
      textTokens: output,
      reasoningTokens: undefined,
    },
    totalTokens:
      input === undefined || output === undefined ? undefined : input + output,
  };
}

describe("model cost estimation", () => {
  it("prices input, output, cache reads, and cache writes separately", () => {
    expect(
      estimateGenerationCost({
        providerId: "anthropic",
        model: "claude-sonnet-4-6",
        usage: usage({
          input: 1_100,
          output: 50,
          noCache: 100,
          cacheRead: 900,
          cacheWrite: 100,
        }),
      }),
    ).toEqual({
      costSource: "models.dev",
      inputCostNanoUsd: 300_000,
      outputCostNanoUsd: 750_000,
      cacheReadCostNanoUsd: 270_000,
      cacheWriteCostNanoUsd: 375_000,
      totalCostNanoUsd: 1_695_000,
    });
  });

  it("uses the Anthropic 1-hour cache-write rate when configured", () => {
    expect(
      estimateGenerationCost({
        providerId: "anthropic",
        model: "claude-sonnet-4-6",
        cacheWriteTtl: "1h",
        usage: usage({
          input: 1_100,
          output: 50,
          noCache: 100,
          cacheRead: 900,
          cacheWrite: 100,
        }),
      }),
    ).toMatchObject({
      cacheWriteCostNanoUsd: 600_000,
      totalCostNanoUsd: 1_920_000,
    });
  });

  it("applies context tiers using each provider call's input size", () => {
    expect(
      estimateGenerationCost({
        providerId: "openai",
        model: "gpt-5.5",
        usage: usage({
          input: 300_000,
          output: 100,
          noCache: 300_000,
        }),
      }),
    ).toMatchObject({
      inputCostNanoUsd: 3_000_000_000,
      outputCostNanoUsd: 4_500_000,
      totalCostNanoUsd: 3_004_500_000,
    });
  });

  it("derives uncached input when a provider omits the detail", () => {
    expect(
      estimateGenerationCost({
        providerId: "openai",
        model: "gpt-4",
        usage: usage({ input: 1_000, output: 100 }),
      }),
    ).toMatchObject({
      inputCostNanoUsd: 30_000_000,
      outputCostNanoUsd: 6_000_000,
      totalCostNanoUsd: 36_000_000,
    });
  });

  it("keeps unknown models and incomplete usage unpriced", () => {
    expect(
      estimateGenerationCost({
        providerId: "custom",
        model: "private-model",
        usage: usage({ input: 100, output: 20 }),
      }),
    ).toBeNull();
    expect(
      estimateGenerationCost({
        providerId: "openai",
        model: "gpt-4",
        usage: usage({ input: 100 }),
      }),
    ).toBeNull();
  });

  it("prices custom models with configured USD-per-million rates", () => {
    expect(
      estimateGenerationCost({
        providerId: "custom",
        model: "private-model",
        pricing: {
          input: 2,
          output: 8,
          cacheRead: 0.2,
          cacheWrite: 2.5,
        },
        usage: usage({
          input: 1_100,
          output: 50,
          noCache: 100,
          cacheRead: 900,
          cacheWrite: 100,
        }),
      }),
    ).toEqual({
      costSource: "model_config",
      inputCostNanoUsd: 200_000,
      outputCostNanoUsd: 400_000,
      cacheReadCostNanoUsd: 180_000,
      cacheWriteCostNanoUsd: 250_000,
      totalCostNanoUsd: 1_030_000,
    });
  });

  it("prefers configured pricing over catalog rates", () => {
    expect(
      estimateGenerationCost({
        providerId: "openai",
        model: "gpt-4",
        pricing: {
          input: 1,
          output: 2,
          cacheRead: 0.1,
          cacheWrite: 0.5,
        },
        usage: usage({ input: 100, output: 10 }),
      }),
    ).toMatchObject({
      costSource: "model_config",
      inputCostNanoUsd: 100_000,
      outputCostNanoUsd: 20_000,
      totalCostNanoUsd: 120_000,
    });
  });

  it("treats explicit zero rates as a priced generation", () => {
    expect(
      estimateGenerationCost({
        providerId: "custom",
        model: "local-model",
        pricing: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        usage: usage({ input: 100, output: 10 }),
      }),
    ).toEqual({
      costSource: "model_config",
      inputCostNanoUsd: 0,
      outputCostNanoUsd: 0,
      cacheReadCostNanoUsd: 0,
      cacheWriteCostNanoUsd: 0,
      totalCostNanoUsd: 0,
    });
  });

  it("fails open when pricing lookup throws", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const catalogSpy = vi
      .spyOn(modelCatalog, "catalogEntryFor")
      .mockImplementation(() => {
        throw new Error("broken catalog");
      });

    expect(
      estimateGenerationCost({
        providerId: "openai",
        model: "gpt-4",
        usage: usage({ input: 100, output: 20 }),
      }),
    ).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[generation-cost]",
      expect.any(Error),
    );

    catalogSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("sums per-call estimates without reapplying pricing tiers", () => {
    const first = estimateGenerationCost({
      providerId: "openai",
      model: "gpt-4",
      usage: usage({ input: 100, output: 10 }),
    });
    const second = estimateGenerationCost({
      providerId: "openai",
      model: "gpt-4",
      usage: usage({ input: 200, output: 20 }),
    });

    expect(
      sumEstimatedGenerationCosts(
        [first, second].filter((cost) => cost !== null),
      ),
    ).toEqual({
      costSource: "models.dev",
      inputCostNanoUsd: 9_000_000,
      outputCostNanoUsd: 1_800_000,
      cacheReadCostNanoUsd: 0,
      cacheWriteCostNanoUsd: 0,
      totalCostNanoUsd: 10_800_000,
    });
  });

  it("preserves configured pricing when summing calls", () => {
    const pricing = {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
    };
    const first = estimateGenerationCost({
      providerId: "custom",
      model: "local-model",
      pricing,
      usage: usage({ input: 100, output: 10 }),
    });
    const second = estimateGenerationCost({
      providerId: "custom",
      model: "local-model",
      pricing,
      usage: usage({ input: 200, output: 20 }),
    });

    expect(
      sumEstimatedGenerationCosts(
        [first, second].filter((cost) => cost !== null),
      ),
    ).toEqual({
      costSource: "model_config",
      inputCostNanoUsd: 300_000,
      outputCostNanoUsd: 60_000,
      cacheReadCostNanoUsd: 0,
      cacheWriteCostNanoUsd: 0,
      totalCostNanoUsd: 360_000,
    });
  });

  it("does not combine estimates from different pricing sources", () => {
    const catalogCost = estimateGenerationCost({
      providerId: "openai",
      model: "gpt-4",
      usage: usage({ input: 100, output: 10 }),
    });
    const configuredCost = estimateGenerationCost({
      providerId: "openai",
      model: "gpt-4",
      pricing: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
      },
      usage: usage({ input: 100, output: 10 }),
    });

    expect(
      sumEstimatedGenerationCosts(
        [catalogCost, configuredCost].filter((cost) => cost !== null),
      ),
    ).toBeNull();
  });

  it("supports every priced text model in the vendored catalog", () => {
    for (const [providerId, models] of Object.entries(catalogJson)) {
      for (const [model, entry] of Object.entries(models)) {
        if (!("cost" in entry) || !entry.cost) continue;

        expect(
          estimateGenerationCost({
            providerId: providerId as ProviderId,
            model,
            usage: usage({
              input: 300_001,
              output: 100,
              noCache: 100_001,
              cacheRead: 100_000,
              cacheWrite: 100_000,
            }),
          }),
          `${providerId}/${model}`,
        ).not.toBeNull();
      }
    }
  });
});
