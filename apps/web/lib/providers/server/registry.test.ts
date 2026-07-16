import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PROVIDER_IDS } from "@/lib/providers/catalog";
import {
  createConfiguredLanguageModel,
  getProviderAdapter,
  registeredProviderIds,
} from "./registry";

const baseConfig = {
  apiFormat: "auto" as const,
  baseUrl: "https://api.example.test/v1",
  apiKey: "secret",
  model: "test-model",
  providerOptions: null,
};

describe("provider registry", () => {
  it("registers exactly one adapter for every catalog provider", () => {
    expect(registeredProviderIds()).toEqual(PROVIDER_IDS);
    for (const providerId of PROVIDER_IDS) {
      expect(getProviderAdapter(providerId).id).toBe(providerId);
    }
  });

  it("mounts provider options under the stable provider identity", () => {
    const configured = createConfiguredLanguageModel({
      ...baseConfig,
      providerId: "bedrock",
      model: "openai.gpt-5.6-terra",
      providerOptions: { reasoningEffort: "high" },
    });

    expect(configured.providerOptions).toEqual({
      bedrock: { reasoningEffort: "high" },
    });
  });

  it("merges native provider defaults with saved options", () => {
    const configured = createConfiguredLanguageModel({
      ...baseConfig,
      providerId: "google",
      providerOptions: { thinkingConfig: { includeThoughts: false } },
    });

    expect(configured.providerOptions).toEqual({
      google: { thinkingConfig: { includeThoughts: false } },
    });
  });

  it("does not permit auto-detection for a custom endpoint", () => {
    expect(() =>
      createConfiguredLanguageModel({
        ...baseConfig,
        providerId: "custom",
      }),
    ).toThrow("require an explicit API format");
  });

  it("does not permit protocol overrides for a registered provider", () => {
    expect(() =>
      createConfiguredLanguageModel({
        ...baseConfig,
        providerId: "openai",
        apiFormat: "openai-chat",
      }),
    ).toThrow("manages its API format automatically");
  });
});
