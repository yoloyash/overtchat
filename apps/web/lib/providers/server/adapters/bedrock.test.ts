import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getMantleRoot,
  resolveBedrockTransport,
} from "./bedrock";

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
});
