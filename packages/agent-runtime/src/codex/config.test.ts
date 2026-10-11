import { describe, expect, it } from "vitest";
import { codexConfiguredDefaults, codexConfiguredModels } from "./config";

const modelList = {
  data: [
    { model: "gpt-default", isDefault: true, inputModalities: ["text", "image"] },
    {
      model: "gpt-configured",
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
    },
  ],
};

describe("Codex configured models", () => {
  it("advertises the configured local model without unrelated GPT models or capabilities", () => {
    const models = codexConfiguredModels(modelList, {
      config: { model: "local/qwen", model_provider: "vllm" },
    });
    expect(models).toEqual([expect.objectContaining({
      id: "local/qwen", label: "local/qwen", isDefault: true,
      input: ["text"], reasoning: false, contextWindow: null, maxTokens: null,
    })]);
    expect(models[0].thinkingOptions).toBeUndefined();
  });

  it("preserves a configured model and effort even when model/list is empty", () => {
    const models = codexConfiguredModels({ data: [] }, {
      config: { model: "local/qwen", model_provider: "vllm", model_reasoning_effort: "high" },
    });
    expect(models[0]).toMatchObject({
      id: "local/qwen", defaultThinkingOptionId: "high",
      thinkingOptions: [{ id: "high", isDefault: true }],
    });
  });

  it("uses configured OpenAI defaults while retaining other catalog models", () => {
    const models = codexConfiguredModels(modelList, {
      config: { model: "gpt-configured", model_provider: "openai", model_reasoning_effort: "high" },
    });
    expect(models).toHaveLength(2);
    expect(models[0].isDefault).toBe(false);
    expect(models[1]).toMatchObject({ isDefault: true, defaultThinkingOptionId: "high" });
    expect(models[1].thinkingOptions).toEqual([
      { id: "low", label: "Low", isDefault: false },
      { id: "high", label: "High", isDefault: true },
    ]);
  });

  it("retains a custom catalog that already contains the configured model", () => {
    const models = codexConfiguredModels({ data: [{ model: "local/a" }, { model: "local/b" }] }, {
      config: { model: "local/b", model_provider: "vllm" },
    });
    expect(models.map((model) => model.id)).toEqual(["local/a", "local/b"]);
    expect(models[1].isDefault).toBe(true);
  });

  it("keeps native defaults for a gateway without an explicit model", () => {
    const models = codexConfiguredModels(modelList, { config: { model_provider: "gateway" } });
    expect(models.map((model) => model.id)).toEqual(["gpt-default", "gpt-configured"]);
    expect(models[0].isDefault).toBe(true);
  });

  it("prefers effective project config and never resurrects unset legacy settings", () => {
    const saved = { config: { model: "old", modelReasoningEffort: "high" } };
    expect(codexConfiguredDefaults({ config: { model: "project" } }, saved)).toMatchObject({
      model: "project", thinkingLevel: null,
    });
    expect(codexConfiguredDefaults(null, saved)).toMatchObject({ model: "old", thinkingLevel: "high" });
  });
});
