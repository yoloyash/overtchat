import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatModel: vi.fn(() => ({ specificationVersion: "v4" })),
  createOpenAICompatible: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}));

import { createOpenAICompatibleChatModel } from "./transports";

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
    });
    expect(mocks.chatModel).toHaveBeenCalledWith("solar-open2-250b");
  });
});
