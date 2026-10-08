import { describe, expect, it } from "vitest";
import {
  changeModelProvider,
  modelDraft,
  parseModelDraft,
} from "./settings-model";
import type { AdminModelConfig } from "@overtchat/shared/admin-settings";
const existing: AdminModelConfig = {
  ...modelDraft(),
  id: "model",
  updatedAt: 1,
  label: "Test",
  model: "gpt-test",
  apiKey: "saved-key",
  pricing: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.7 },
  contextWindow: 12345,
  discoveredContextWindow: 9999,
  discoveredCapabilities: { toolCalling: true },
  systemPrompt: "Keep me",
  providerOptions: { openai: { store: false } },
  catalogPricing: null,
  enabled: false,
  taskModel: false,
  sortOrder: 2,
};
describe("native model edits", () => {
  it("preserves advanced settings and credentials when changing a simple field", () => {
    const draft = modelDraft(existing);
    const input = parseModelDraft(
      { ...draft, label: "Renamed", enabled: true },
      JSON.stringify(draft.providerOptions),
      String(draft.contextWindow),
    );
    expect(input).toEqual({ ...draft, label: "Renamed", enabled: true });
    expect(input).not.toHaveProperty("id");
    expect(input).not.toHaveProperty("taskModel");
  });
  it("clears provider-specific discovery and secrets when switching providers", () => {
    const next = changeModelProvider(modelDraft(existing), "anthropic");
    expect(next).toMatchObject({
      apiKey: null,
      model: "",
      providerOptions: null,
      discoveredCapabilities: null,
      discoveredContextWindow: null,
      providerId: "anthropic",
    });
    expect(next.systemPrompt).toBe("Keep me");
  });
  it.each(["[]", "null", '"string"', "{broken"])(
    "rejects invalid provider options %s",
    (options) => {
      expect(() =>
        parseModelDraft(modelDraft(existing), options, "1000"),
      ).toThrow();
    },
  );
  it.each(["0", "-1", "1.5", "invalid", "Infinity"])(
    "rejects invalid context limit %s",
    (context) => {
      expect(() =>
        parseModelDraft(modelDraft(existing), "{}", context),
      ).toThrow();
    },
  );
});
