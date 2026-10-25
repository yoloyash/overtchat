import { describe, expect, it } from "vitest";
import { ModelConfigSchema } from "./schema";
import {
  REASONING_OVERRIDE_PRESETS,
  overrideFromControls,
  reasoningControlsFromOverride,
  reasoningOverrideIssue,
} from "./reasoning-override";

const base = {
  label: "Local",
  providerId: "vllm",
  apiFormat: "auto",
  baseUrl: "http://local/v1",
  model: "test",
};

describe("thinking overrides", () => {
  it("derives public controls that every client renders the same way", () => {
    expect(
      reasoningControlsFromOverride({
        defaultLevel: "on",
        requests: { on: {}, off: {} },
      }),
    ).toEqual({ toggle: true, defaultLevel: "on" });
    expect(
      reasoningControlsFromOverride({
        defaultLevel: "high",
        requests: { off: {}, high: {}, low: {} },
      }),
    ).toEqual({ toggle: true, defaultLevel: "high", efforts: ["low", "high"] });
    expect(reasoningControlsFromOverride({ requests: {} })).toBeUndefined();
  });

  it("accepts every preset", () => {
    for (const preset of REASONING_OVERRIDE_PRESETS) {
      expect(
        ModelConfigSchema.safeParse({
          ...base,
          reasoningOverride: preset.override,
        }).success,
      ).toBe(true);
    }
  });

  it.each([
    [{ defaultLevel: "on", requests: { on: {} } }, "both on and off"],
    [{ requests: { on: {}, off: {} } }, "default thinking level"],
    [
      { defaultLevel: "low", requests: { on: {}, off: {} } },
      "one of the configured levels",
    ],
    [
      { defaultLevel: "high", requests: { on: {}, high: {} } },
      "only offered as the default",
    ],
    [{ defaultLevel: "on", requests: { ultra: {} } }, 'Unknown thinking level "ultra"'],
  ])("rejects %j", (override, message) => {
    expect(reasoningOverrideIssue(override)).toContain(message);
    const result = ModelConfigSchema.safeParse({
      ...base,
      reasoningOverride: override,
    });
    expect(result.success).toBe(false);
  });

  it("rejects request fields that are not objects", () => {
    expect(
      ModelConfigSchema.safeParse({
        ...base,
        reasoningOverride: { defaultLevel: "high", requests: { high: "x" } },
      }).success,
    ).toBe(false);
  });

  it("only applies to Chat Completions-compatible providers", () => {
    expect(
      ModelConfigSchema.safeParse({
        ...base,
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "key",
        reasoningOverride: REASONING_OVERRIDE_PRESETS[0].override,
      }).success,
    ).toBe(false);
  });

  it("converts automatic controls into the fields chat already sends", () => {
    expect(
      overrideFromControls({
        toggle: true,
        defaultLevel: "medium",
        efforts: ["low", "medium"],
      }),
    ).toEqual({
      defaultLevel: "medium",
      requests: {
        off: {
          reasoning_effort: "none",
          chat_template_kwargs: { enable_thinking: false },
        },
        low: {
          reasoning_effort: "low",
          chat_template_kwargs: { enable_thinking: true },
        },
        medium: {
          reasoning_effort: "medium",
          chat_template_kwargs: { enable_thinking: true },
        },
      },
    });
  });
});
