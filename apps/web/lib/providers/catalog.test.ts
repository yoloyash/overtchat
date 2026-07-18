import { describe, expect, it } from "vitest";
import {
  API_FORMATS,
  getProvider,
  modelIconForModel,
  PROVIDER_IDS,
  PROVIDERS,
} from "./catalog";

describe("provider catalog", () => {
  it("defines complete metadata for every provider", () => {
    expect(Object.keys(PROVIDERS)).toEqual(PROVIDER_IDS);
    for (const providerId of PROVIDER_IDS) {
      expect(getProvider(providerId).id).toBe(providerId);
      expect(getProvider(providerId).label).not.toBe("");
    }
  });

  it("keeps API formats separate from provider identity", () => {
    expect(PROVIDERS.openai.defaultApiFormat).toBe("auto");
    expect(PROVIDERS.bedrock.defaultApiFormat).toBe("auto");
    expect(PROVIDERS.custom.defaultApiFormat).toBe("openai-chat");
    expect(API_FORMATS["anthropic-messages"].label).toBe(
      "Anthropic Messages",
    );
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
