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
    expect(configured.providerOptionsKey).toBe("openai");
    expect(configured.promptCacheStrategy).toEqual({ kind: "openai" });
  });

  it("lets adapters declare prompt-cache behavior without chat-route inference", () => {
    expect(
      createConfiguredLanguageModel({
        ...baseConfig,
        providerId: "openai",
      }).promptCacheStrategy,
    ).toEqual({ kind: "openai" });
    expect(
      createConfiguredLanguageModel({
        ...baseConfig,
        providerId: "anthropic",
        providerOptions: {
          cacheControl: { type: "ephemeral", ttl: "1h" },
        },
      }).promptCacheStrategy,
    ).toEqual({
      kind: "anthropic",
      cacheControl: { type: "ephemeral", ttl: "1h" },
    });
    expect(
      createConfiguredLanguageModel({
        ...baseConfig,
        providerId: "bedrock",
        model: "anthropic.claude-sonnet-5",
      }).promptCacheStrategy,
    ).toEqual({
      kind: "anthropic",
      cacheControl: { type: "ephemeral" },
    });
    expect(
      createConfiguredLanguageModel({
        ...baseConfig,
        providerId: "custom",
        apiFormat: "anthropic-messages",
      }).promptCacheStrategy,
    ).toEqual({
      kind: "anthropic",
      cacheControl: { type: "ephemeral" },
    });
    expect(
      createConfiguredLanguageModel({
        ...baseConfig,
        providerId: "google",
      }).promptCacheStrategy,
    ).toBeUndefined();
    expect(
      createConfiguredLanguageModel({
        ...baseConfig,
        providerId: "custom",
        apiFormat: "openai-responses",
      }).promptCacheStrategy,
    ).toBeUndefined();
    expect(
      createConfiguredLanguageModel({
        ...baseConfig,
        providerId: "custom",
        apiFormat: "openai-chat",
      }).promptCacheStrategy,
    ).toBeUndefined();
    expect(
      createConfiguredLanguageModel({
        ...baseConfig,
        providerId: "bedrock",
        model: "qwen.qwen3-coder-next",
      }).promptCacheStrategy,
    ).toBeUndefined();
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

  it("serializes disabled reasoning for custom OpenAI-compatible models", async () => {
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
      providerId: "custom",
      apiFormat: "openai-chat",
    });
    const providerOptions = {
      ...configured.providerOptions,
      [configured.providerOptionsKey]: {
        ...configured.providerOptions?.[configured.providerOptionsKey],
        reasoningEffort: "none",
      },
    };

    await expect(
      generateText({
        model: configured.model,
        prompt: "Generate a title",
        providerOptions,
      }),
    ).rejects.toThrow("intentional test response");

    expect(requestBody).toMatchObject({
      reasoning_effort: "none",
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

  it.each(["vllm", "llamacpp", "sglang"] as const)(
    "uses the shared OpenAI-compatible transport for %s without requiring a key",
    (providerId) => {
      const configured = createConfiguredLanguageModel({
        ...baseConfig,
        providerId,
        apiKey: "",
      });

      expect(configured.providerOptionsKey).toBe(providerId);
      expect(configured.promptCacheStrategy).toBeUndefined();
      expect(() =>
        validateProviderConnection({
          ...baseConfig,
          providerId,
          apiKey: "",
        }),
      ).not.toThrow();
    },
  );

  it("requests and preserves live activity fields from llama.cpp", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const progressChunk = {
      id: "chatcmpl-test",
      choices: [
        { delta: { role: "assistant", content: null }, finish_reason: null },
      ],
      timings: {
        cache_n: 0,
        prompt_n: 7,
        prompt_ms: 167.085,
        predicted_n: 0,
        predicted_ms: 0,
      },
      prompt_progress: {
        total: 11,
        cache: 0,
        processed: 7,
        time_ms: 168,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          [
            `data: ${JSON.stringify(progressChunk)}`,
            'data: {"id":"chatcmpl-test","choices":[{"delta":{"content":"ok"},"finish_reason":null}]}',
            'data: {"id":"chatcmpl-test","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
            "data: [DONE]",
            "",
          ].join("\n\n"),
          { headers: { "content-type": "text/event-stream" } },
        );
      }),
    );
    const configured = createConfiguredLanguageModel({
      ...baseConfig,
      providerId: "llamacpp",
    });

    const result = await configured.model.doStream({
      includeRawChunks: true,
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    });
    const rawChunks: unknown[] = [];
    await result.stream.pipeTo(
      new WritableStream({
        write(part) {
          if (part.type === "raw") rawChunks.push(part.rawValue);
        },
      }),
    );

    expect(requestBody).toMatchObject({
      stream: true,
      return_progress: true,
      timings_per_token: true,
    });
    expect(rawChunks).toContainEqual(progressChunk);
  });

  it("uses the shared OpenAI-compatible transport for DeepSeek", () => {
    const configured = createConfiguredLanguageModel({
      ...baseConfig,
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });

    expect(configured.providerOptionsKey).toBe("deepseek");
    expect(configured.promptCacheStrategy).toBeUndefined();
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
    expect(() =>
      validateProviderConnection({
        ...baseConfig,
        providerId: "deepseek",
        apiKey: "",
      }),
    ).toThrow("DeepSeek requires an API key");
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
