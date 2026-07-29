import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  bedrockAdapter,
  getMantleRoot,
  resolveBedrockTransport,
} from "./bedrock";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Amazon Bedrock model routing", () => {
  it.each([
    ["anthropic.claude-sonnet-5", "anthropic-messages"],
    ["anthropic.claude-opus-4-8", "anthropic-messages"],
    ["openai.gpt-5.4", "openai-responses"],
    ["openai.gpt-5.6-terra", "openai-responses"],
    ["openai.gpt-oss-120b", "openai-chat"],
    ["deepseek.v3.2", "openai-chat"],
    ["google.gemma-4-31b", "openai-chat"],
    ["minimax.minimax-m2.5", "openai-chat"],
    ["mistral.ministral-3-14b-instruct", "openai-chat"],
    ["moonshotai.kimi-k2.5", "openai-chat"],
    ["nvidia.nemotron-super-3-120b", "openai-chat"],
    ["qwen.qwen3-coder-next", "openai-chat"],
    ["writer.palmyra-vision-7b", "openai-chat"],
    ["xai.grok-4.3", "openai-chat"],
    ["zai.glm-5", "openai-chat"],
  ] as const)("routes %s through %s", (modelId, transport) => {
    expect(resolveBedrockTransport(modelId)).toBe(transport);
  });

  it("rejects unknown model families instead of guessing a protocol", () => {
    expect(() => resolveBedrockTransport("future.unknown-model")).toThrow(
      'Unsupported Bedrock model "future.unknown-model"',
    );
  });

  it("derives namespaced Mantle endpoints from the documented /v1 root", () => {
    expect(
      getMantleRoot("https://bedrock-mantle.eu-west-1.api.aws/v1/"),
    ).toBe("https://bedrock-mantle.eu-west-1.api.aws");
    expect(() =>
      getMantleRoot("https://bedrock-mantle.eu-west-1.api.aws"),
    ).toThrow("must end with /v1");
  });

  it("filters unsupported discovery results without dropping model metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: [
            {
              id: "anthropic.claude-sonnet-5",
              max_context_length: 1_000_000,
            },
            {
              id: "future.unknown-model",
              max_context_length: 32_768,
            },
            { id: "qwen.qwen3-coder-next" },
          ],
        }),
      ),
    );

    await expect(
      bedrockAdapter.listModels({
        providerId: "bedrock",
        apiFormat: "auto",
        baseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1",
        apiKey: "secret",
      }),
    ).resolves.toEqual([
      {
        id: "anthropic.claude-sonnet-5",
        contextWindow: 1_000_000,
      },
      { id: "qwen.qwen3-coder-next" },
    ]);
  });
});
