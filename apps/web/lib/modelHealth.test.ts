import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createConfiguredLanguageModel: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
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
});
