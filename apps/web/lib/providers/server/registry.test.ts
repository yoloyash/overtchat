import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PROVIDER_IDS } from "@/lib/providers/catalog";
import { ProviderConfigurationError } from "@/lib/providers/server/errors";
import {
  createConfiguredLanguageModel,
  getProviderAdapter,
  validateProviderConnection,
  validateProviderModelConfig,
} from "./registry";

const baseConfig = {
  apiFormat: "auto" as const,
  baseUrl: "https://api.example.test/v1",
  apiKey: "secret",
  model: "test-model",
  providerOptions: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider registry", () => {
  it("maps every catalog provider to its matching adapter", () => {
    for (const providerId of PROVIDER_IDS) {
      expect(getProviderAdapter(providerId).id).toBe(providerId);
    }
  });

  it("mounts provider options under the transport SDK identity", () => {
    const configured = createConfiguredLanguageModel({
      ...baseConfig,
      providerId: "bedrock",
      model: "openai.gpt-5.6-terra",
      providerOptions: { reasoningEffort: "high" },
    });

    expect(configured.providerOptions).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "high" },
    });
  });

  it("serializes namespaced Bedrock GPT models as reasoning models", async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            error: {
              message: "intentional test response",
              type: "invalid_request_error",
              param: null,
              code: null,
            },
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );
    const configured = createConfiguredLanguageModel({
      ...baseConfig,
      providerId: "bedrock",
      model: "openai.gpt-5.6-terra",
      providerOptions: { reasoningEffort: "high" },
    });

    await expect(
      generateText({
        model: configured.model,
        system: "Stable system instructions",
        prompt: "Hello",
        providerOptions: configured.providerOptions,
      }),
    ).rejects.toThrow("intentional test response");

    expect(requestBody).toMatchObject({
      reasoning: { effort: "high", summary: "detailed" },
      input: [
        expect.objectContaining({ role: "developer" }),
        expect.objectContaining({ role: "user" }),
      ],
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

  it("rejects malformed endpoints and missing registered-provider credentials", () => {
    expect(() =>
      validateProviderConnection({
        ...baseConfig,
        providerId: "openai",
        baseUrl: "not a URL",
      }),
    ).toThrow("absolute HTTP or HTTPS URL");
    expect(() =>
      validateProviderConnection({
        ...baseConfig,
        providerId: "anthropic",
        apiKey: "",
      }),
    ).toThrow("requires an API key");
  });

  it("runs Bedrock endpoint and model-family validation before construction", () => {
    expect(() =>
      validateProviderModelConfig({
        ...baseConfig,
        providerId: "bedrock",
        baseUrl: "https://bedrock-mantle.us-east-1.api.aws",
        model: "openai.gpt-5.6-terra",
      }),
    ).toThrow("must end with /v1");
    expect(() =>
      validateProviderModelConfig({
        ...baseConfig,
        providerId: "bedrock",
        baseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1",
        model: "future.unknown-model",
      }),
    ).toThrow('Unsupported Bedrock model "future.unknown-model"');
  });

  it("fails malformed persisted provider identities with a typed error", () => {
    let error: unknown;
    try {
      validateProviderModelConfig({
        ...baseConfig,
        providerId: "corrupt-provider" as never,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ProviderConfigurationError);
    expect(error).toMatchObject({
      message: 'Unsupported model provider "corrupt-provider".',
    });
  });
});
