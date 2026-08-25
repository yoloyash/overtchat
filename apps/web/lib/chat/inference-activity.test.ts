import { describe, expect, it } from "vitest";
import { isInferenceActivity } from "./inference-activity";

describe("inference activity", () => {
  it("accepts a valid provider-neutral activity snapshot", () => {
    expect(
      isInferenceActivity({
        phase: "prompt",
        completedTokens: 1_536,
        totalTokens: 2_048,
        cachedTokens: 0,
        elapsedMs: 3_200,
        progress: 0.75,
        tokensPerSecond: 480,
      }),
    ).toBe(true);
  });

  it("rejects invalid activity data", () => {
    expect(
      isInferenceActivity({
        phase: "prompt",
        completedTokens: -1,
        progress: 2,
      }),
    ).toBe(false);
    expect(isInferenceActivity({ phase: "waiting" })).toBe(false);
  });
});
