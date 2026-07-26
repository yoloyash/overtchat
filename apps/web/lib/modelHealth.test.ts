import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createConfiguredLanguageModel: vi.fn(),
  generateText: vi.fn(),
  tool: vi.fn((definition) => definition),
}));

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({
  generateText: mocks.generateText,
  tool: mocks.tool,
}));
vi.mock("@/lib/providers/server/registry", () => ({
  createConfiguredLanguageModel: mocks.createConfiguredLanguageModel,
}));

import { ProviderConfigurationError } from "@/lib/providers/server/errors";
import { pingModel } from "./modelHealth";

const config = {
  providerId: "custom" as const,
  apiFormat: "openai-chat" as const,
  baseUrl: "http://example.test/v1",
  apiKey: "key",
  model: "test-model",
  providerOptions: null,
  toolCallingEnabled: false,
};

describe("model health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createConfiguredLanguageModel.mockReturnValue({
      model: "model",
      providerOptions: undefined,
    });
    mocks.generateText.mockResolvedValue({
      text: "Hi.",
      toolCalls: [],
      usage: { inputTokens: 3, outputTokens: 2 },
    });
  });

  it("returns a configuration failure when model construction throws", async () => {
    mocks.createConfiguredLanguageModel.mockImplementation(() => {
      throw new ProviderConfigurationError("unsupported model family");
    });

    await expect(pingModel(config)).resolves.toMatchObject({
      ok: false,
      kind: "configuration",
      error: "unsupported model family",
    });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("distinguishes an upstream request failure", async () => {
    mocks.generateText.mockRejectedValue(new Error("provider unavailable"));

    await expect(pingModel(config)).resolves.toMatchObject({
      ok: false,
      kind: "upstream",
      error: "provider unavailable",
    });
  });

  it("returns usage for a successful ping", async () => {
    await expect(pingModel(config)).resolves.toMatchObject({
      ok: true,
      text: "Hi.",
      inputTokens: 3,
      outputTokens: 2,
    });
  });

  it("requires a harmless tool call for tool-capable models", async () => {
    mocks.generateText.mockResolvedValue({
      text: "",
      toolCalls: [{ toolName: "connection_check", input: {} }],
      usage: { inputTokens: 5, outputTokens: 1 },
    });

    await expect(
      pingModel({ ...config, toolCallingEnabled: true }),
    ).resolves.toMatchObject({
      ok: true,
      text: "Tool calling verified.",
      inputTokens: 5,
      outputTokens: 1,
    });

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: "Call connection_check exactly once.",
        toolChoice: "required",
        tools: expect.objectContaining({ connection_check: expect.anything() }),
      }),
    );
  });

  it("rejects a tool-capable model that ignores required tool choice", async () => {
    mocks.generateText.mockResolvedValue({
      text: "I cannot call tools.",
      toolCalls: [],
      usage: { inputTokens: 5, outputTokens: 5 },
    });

    await expect(
      pingModel({ ...config, toolCallingEnabled: true }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "upstream",
      error:
        "Connection succeeded, but the model did not call the required test tool. Turn off Tool calling if this model does not support tools.",
    });
  });
});
