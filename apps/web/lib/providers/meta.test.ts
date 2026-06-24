import { describe, expect, it } from "vitest";
import {
  modelIconForModel,
  providerIdentityForBaseUrl,
  providerIconForPreset,
} from "./meta";

describe("provider metadata", () => {
  it("maps presets to provider icons", () => {
    expect(providerIconForPreset("openai")).toBe("openai");
    expect(providerIconForPreset("anthropic")).toBe("anthropic");
    expect(providerIconForPreset("google")).toBe("gemini");
    expect(providerIconForPreset("custom")).toBeNull();
  });

  it("keeps custom endpoints generic", () => {
    expect(providerIdentityForBaseUrl("http://localhost:11434/v1")).toMatchObject({
      iconId: null,
      label: "Custom",
      preset: "custom",
    });
  });

  it.each([
    ["claude-sonnet-4-5", "claude"],
    ["gemini-2.5-flash", "gemini"],
    ["deepseek-r1", "deepseek"],
    ["qwen3-coder", "qwen"],
    ["mixtral-8x7b", "mistral"],
    ["minimax-m1", "minimax"],
    ["llama-3.3-70b", "meta"],
    ["gpt-4o-mini", "openai"],
  ] as const)("maps %s to %s", (model, iconId) => {
    expect(modelIconForModel(model)).toBe(iconId);
  });
});
