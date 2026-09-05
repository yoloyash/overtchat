import { describe, expect, it } from "vitest";
import {
  applyAnthropicReasoningLevel,
  applyDeepSeekReasoningBody,
  applyDeepSeekReasoningOptions,
  applyGoogleReasoningLevel,
  applyOpenAIReasoningLevel,
} from "./cloud-reasoning";

describe("cloud reasoning controls", () => {
  it("leaves saved parameters untouched for the default selection", () => {
    const options = { reasoningEffort: "high", custom: true };
    expect(applyOpenAIReasoningLevel(options, "default")).toBe(options);
  });

  it("overrides only OpenAI's configured effort", () => {
    expect(
      applyOpenAIReasoningLevel(
        { reasoningEffort: "high", reasoningSummary: "auto" },
        "off",
      ),
    ).toEqual({ reasoningEffort: "none", reasoningSummary: "auto" });
  });

  it("uses Anthropic adaptive thinking and preserves display controls", () => {
    expect(
      applyAnthropicReasoningLevel(
        {
          effort: "low",
          cacheControl: { type: "ephemeral" },
          thinking: { type: "enabled", budgetTokens: 4096, display: "summarized" },
        },
        "max",
      ),
    ).toEqual({
      effort: "max",
      cacheControl: { type: "ephemeral" },
      thinking: { type: "adaptive", display: "summarized" },
    });
    expect(
      applyAnthropicReasoningLevel(
        { effort: "high", thinking: { type: "adaptive", display: "summarized" } },
        "off",
      ),
    ).toEqual({ thinking: { type: "disabled" } });
  });

  it("uses Google's native level while preserving unrelated thinking options", () => {
    expect(
      applyGoogleReasoningLevel(
        {
          safetySettings: [],
          thinkingConfig: {
            thinkingBudget: 4096,
            thinkingLevel: "low",
            includeThoughts: false,
          },
        },
        "high",
      ),
    ).toEqual({
      safetySettings: [],
      thinkingConfig: { thinkingLevel: "high", includeThoughts: false },
    });
  });

  it("separates DeepSeek's effort and toggle controls", () => {
    expect(
      applyDeepSeekReasoningOptions(
        { reasoningEffort: "high", custom: true },
        "off",
      ),
    ).toEqual({ custom: true });
    expect(
      applyDeepSeekReasoningBody(
        {
          reasoning_effort: "high",
          thinking: { type: "enabled", custom: true },
        },
        "off",
      ),
    ).toEqual({ thinking: { type: "disabled", custom: true } });
    expect(
      applyDeepSeekReasoningBody({ reasoning_effort: "max" }, "max"),
    ).toEqual({
      reasoning_effort: "max",
      thinking: { type: "enabled" },
    });
  });
});
