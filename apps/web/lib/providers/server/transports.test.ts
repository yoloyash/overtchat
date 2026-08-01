import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatModel: vi.fn(() => ({ specificationVersion: "v4" })),
  createOpenAICompatible: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}));

import {
  convertOpenAICompatibleUsage,
  createOpenAICompatibleChatModel,
} from "./transports";

describe("OpenAI-compatible transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOpenAICompatible.mockReturnValue({
      chatModel: mocks.chatModel,
    });
  });

  it("requests usage in the final streaming chunk", () => {
    createOpenAICompatibleChatModel({
      providerName: "custom.openai-compatible",
      baseUrl: "http://localhost:8080/v1",
      apiKey: null,
      model: "solar-open2-250b",
    });

    expect(mocks.createOpenAICompatible).toHaveBeenCalledWith({
      name: "custom.openai-compatible",
      baseURL: "http://localhost:8080/v1",
      apiKey: "none",
      includeUsage: true,
      convertUsage: expect.any(Function),
    });
    expect(mocks.chatModel).toHaveBeenCalledWith("solar-open2-250b");
  });

  it("normalizes DeepSeek cache hits without treating misses as writes", () => {
    const raw = {
      prompt_tokens: 150,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 100,
      prompt_cache_miss_tokens: 50,
    };

    expect(convertOpenAICompatibleUsage(raw)).toEqual({
      inputTokens: {
        total: 150,
        noCache: 50,
        cacheRead: 100,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: 200,
        text: 200,
        reasoning: 0,
      },
      raw,
    });
  });

  it("preserves standard OpenAI-compatible usage details", () => {
    const raw = {
      prompt_tokens: 1_000,
      completion_tokens: 120,
      prompt_tokens_details: { cached_tokens: 250 },
      completion_tokens_details: { reasoning_tokens: 20 },
    };

    expect(convertOpenAICompatibleUsage(raw)).toEqual({
      inputTokens: {
        total: 1_000,
        noCache: 750,
        cacheRead: 250,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: 120,
        text: 100,
        reasoning: 20,
      },
      raw,
    });
  });
});
