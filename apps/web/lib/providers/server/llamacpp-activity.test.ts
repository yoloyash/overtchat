import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readLlamaCppInferenceActivity } from "./llamacpp-activity";

describe("llama.cpp inference activity", () => {
  it("reports uncached prompt progress and throughput", () => {
    expect(
      readLlamaCppInferenceActivity({
        choices: [{ delta: { content: null }, finish_reason: null }],
        prompt_progress: {
          total: 2_048,
          cache: 512,
          processed: 1_664,
          time_ms: 2_400,
        },
      }),
    ).toEqual({
      phase: "prompt",
      completedTokens: 1_152,
      totalTokens: 1_536,
      cachedTokens: 512,
      elapsedMs: 2_400,
      progress: 0.75,
      tokensPerSecond: 480,
    });
  });

  it("prefers generation timings once output tokens exist", () => {
    expect(
      readLlamaCppInferenceActivity({
        timings: {
          prompt_n: 2_048,
          prompt_ms: 3_874,
          predicted_n: 125,
          predicted_ms: 3_055,
          predicted_per_second: 40.9165,
          cache_n: 0,
        },
        prompt_progress: {
          total: 2_048,
          cache: 0,
          processed: 2_048,
          time_ms: 3_874,
        },
      }),
    ).toEqual({
      phase: "generation",
      completedTokens: 125,
      elapsedMs: 3_055,
      tokensPerSecond: expect.closeTo(40.9165, 3),
    });
  });

  it("omits the unstable rate from the first generated token", () => {
    expect(
      readLlamaCppInferenceActivity({
        timings: {
          prompt_n: 11,
          prompt_ms: 274.508,
          predicted_n: 1,
          predicted_ms: 0.001,
          predicted_per_second: 0,
          cache_n: 0,
        },
      }),
    ).toEqual({
      phase: "generation",
      completedTokens: 1,
      elapsedMs: 0.001,
    });
  });

  it("ignores unrelated or malformed provider chunks", () => {
    expect(readLlamaCppInferenceActivity({ choices: [] })).toBeNull();
    expect(
      readLlamaCppInferenceActivity({
        prompt_progress: {
          total: 100,
          cache: 101,
          processed: 50,
          time_ms: 10,
        },
      }),
    ).toBeNull();
  });
});
