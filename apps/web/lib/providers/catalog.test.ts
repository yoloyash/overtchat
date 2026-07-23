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
    ["google/gemma-4-31b-it", "gemma"],
    ["deepseek-r1", "deepseek"],
    ["qwen3-coder", "qwen"],
    ["xiaomi/mimo-v2.5", "xiaomimimo"],
    ["z-ai/glm-5.2", "zai"],
    ["nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia"],
    ["moonshotai/kimi-k3", "kimi"],
    ["poolside/laguna-m.1:free", "poolside"],
    ["x-ai/grok-4.5", "grok"],
    ["tencent/hy3", "hunyuan"],
    ["stepfun/step-3.7-flash", "stepfun"],
    ["cohere/north-mini-code:free", "cohere"],
    ["ibm-granite/granite-4.0-h-micro", "ibm"],
    ["amazon/nova-micro-v1", "nova"],
    ["mixtral-8x7b", "mistral"],
    ["minimax-m1", "minimax"],
    ["llama-3.3-70b", "meta"],
    ["meta/muse-spark-1.1", "meta"],
    ["sambanova/llama-3.3-70b", "meta"],
    ["gpt-4o-mini", "openai"],
  ] as const)("maps %s to %s", (model, iconId) => {
    expect(modelIconForModel(model)).toBe(iconId);
  });

  it.each(["custom-step-model", "renovation-model"])(
    "does not infer a brand from incidental text in %s",
    (model) => {
      expect(modelIconForModel(model)).toBeNull();
    },
  );
});
