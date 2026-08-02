import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  catalogCapabilitiesFor,
  catalogContextWindowFor,
  catalogEntryFor,
  catalogPricingFor,
  resolveModelCapabilities,
  resolveModelContextWindow,
} from "./model-catalog";

describe("vendored model catalog", () => {
  it("looks up context limits by exact provider and model ID", () => {
    expect(catalogContextWindowFor("openai", "gpt-4o")).toBe(128_000);
    expect(
      catalogContextWindowFor("anthropic", "claude-sonnet-4-6"),
    ).toBe(1_000_000);
    expect(catalogContextWindowFor("google", "gemini-2.5-flash")).toBe(
      1_048_576,
    );
    expect(
      catalogContextWindowFor(
        "bedrock",
        "us.anthropic.claude-sonnet-5",
      ),
    ).toBe(1_000_000);
  });

  it("does not infer aliases, provider families, or custom models", () => {
    expect(catalogEntryFor("openai", "GPT-4O")).toBeUndefined();
    expect(catalogEntryFor("openai", "claude-sonnet-4-6")).toBeUndefined();
    expect(catalogEntryFor("custom", "gpt-4o")).toBeUndefined();
  });

  it("retains token, cost, modality, and capability metadata", () => {
    expect(catalogEntryFor("anthropic", "claude-sonnet-4-6")).toMatchObject({
      context: 1_000_000,
      output: 128_000,
      cost: {
        input: 3,
        output: 15,
        cache_read: 0.3,
        cache_write: 3.75,
      },
      input_modalities: ["text", "image", "pdf"],
      output_modalities: ["text"],
      attachment: true,
      tool_call: true,
      reasoning: true,
      structured_output: true,
      temperature: true,
    });
    expect(
      catalogCapabilitiesFor("anthropic", "claude-sonnet-4-6"),
    ).toEqual({
      maxOutputTokens: 128_000,
      inputModalities: ["text", "image", "pdf"],
      outputModalities: ["text"],
      attachment: true,
      toolCalling: true,
      reasoning: true,
      structuredOutput: true,
      temperature: true,
    });
  });

  it("normalizes base pricing and identifies context tiers", () => {
    expect(catalogPricingFor("openai", "gpt-4")).toEqual({
      input: 30,
      output: 60,
      cacheRead: 30,
      cacheWrite: 30,
      tiered: false,
    });
    expect(catalogPricingFor("openai", "gpt-5.4")).toEqual({
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
      cacheWrite: 2.5,
      tiered: true,
    });
    expect(
      catalogPricingFor("custom", "private-model"),
    ).toBeUndefined();
  });

  it("merges runtime self-reports over catalog fields", () => {
    expect(
      resolveModelCapabilities(
        {
          maxOutputTokens: 4096,
          inputModalities: ["text"],
          toolCalling: false,
        },
        "openai",
        "gpt-4o",
      ),
    ).toMatchObject({
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["text"],
      attachment: true,
      toolCalling: false,
      reasoning: false,
      structuredOutput: true,
      temperature: true,
    });
  });

  it("resolves override, discovery, catalog, then unknown", () => {
    expect(
      resolveModelContextWindow(32_768, 64_000, "openai", "gpt-4o"),
    ).toBe(32_768);
    expect(
      resolveModelContextWindow(null, 64_000, "openai", "gpt-4o"),
    ).toBe(64_000);
    expect(
      resolveModelContextWindow(null, null, "openai", "gpt-4o"),
    ).toBe(128_000);
    expect(resolveModelContextWindow(0, -1, "openai", "gpt-4o")).toBe(
      128_000,
    );
    expect(
      resolveModelContextWindow(
        undefined,
        undefined,
        "custom",
        "private-model",
      ),
    ).toBeUndefined();
  });
});
