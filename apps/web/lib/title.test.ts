import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";

const mocks = vi.hoisted(() => ({
  createConfiguredLanguageModel: vi.fn(),
  generateText: vi.fn(),
  getChatTitleContext: vi.fn(),
  getTaskModelConfig: vi.fn(),
  setTitleIfNull: vi.fn(),
  tryRecordGenerationUsage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("@/lib/db/chats", () => ({
  getChatTitleContext: mocks.getChatTitleContext,
  setTitleIfNull: mocks.setTitleIfNull,
}));
vi.mock("@/lib/db/modelConfigs", () => ({
  getTaskModelConfig: mocks.getTaskModelConfig,
}));
vi.mock("@/lib/db/generationUsage", () => ({
  tryRecordGenerationUsage: mocks.tryRecordGenerationUsage,
}));
vi.mock("@/lib/providers/server/registry", () => ({
  createConfiguredLanguageModel: mocks.createConfiguredLanguageModel,
}));

import {
  buildTitlePromptText,
  cleanGeneratedTitle,
  ensureChatTitle,
  extractTextForTitle,
} from "./title";

type Part = UIMessage["parts"][number];

const modelConfig = {
  providerId: "custom" as const,
  apiFormat: "openai-chat" as const,
  baseUrl: "http://example.test/v1",
  apiKey: "key",
  model: "title-model",
  pricing: null,
  providerOptions: null,
};

function text(value: string): Part {
  return { type: "text", text: value } as Part;
}

function reasoning(value: string): Part {
  return { type: "reasoning", text: value } as Part;
}

function file(): Part {
  return { type: "file", mediaType: "image/png", url: "file-id" } as Part;
}

function search(): Part {
  return {
    type: "tool-web_search",
    toolCallId: "search",
    state: "output-available",
    input: { query: "hidden query" },
    output: [{ title: "hidden result", snippet: "hidden snippet" }],
  } as unknown as Part;
}

const firstUserParts = [text("How should we simplify title generation?")];

function generationResult(text: string) {
  return {
    text,
    finishReason: "stop",
    usage: {
      inputTokens: 10,
      inputTokenDetails: {
        noCacheTokens: 4,
        cacheReadTokens: 6,
        cacheWriteTokens: 1,
      },
      outputTokens: 2,
      totalTokens: 12,
    },
  };
}

describe("title helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createConfiguredLanguageModel.mockReturnValue({
      model: "model",
      providerOptions: undefined,
      providerOptionsKey: "custom",
    });
    mocks.generateText.mockResolvedValue(
      generationResult("Server Owned Titles"),
    );
    mocks.tryRecordGenerationUsage.mockReturnValue(true);
    mocks.setTitleIfNull.mockImplementation(async (_chatId, title) => title);
    mocks.getChatTitleContext.mockResolvedValue({
      title: null,
      firstUserParts,
    });
    mocks.getTaskModelConfig.mockReturnValue(null);
  });

  it("cleans generated title output", () => {
    expect(cleanGeneratedTitle('  " Fix title generation!!! "  ')).toBe(
      "Fix title generation",
    );
    expect(cleanGeneratedTitle("Line one\n\tline two.")).toBe(
      "Line one line two",
    );
  });

  it("rejects empty cleaned title output", () => {
    expect(cleanGeneratedTitle("   ")).toBeNull();
    expect(cleanGeneratedTitle('"..."')).toBeNull();
  });

  it("extracts only non-blank text parts for title context", () => {
    expect(
      extractTextForTitle([
        text("  Real\nquestion turn0search0 "),
        reasoning("private thought"),
        search(),
        file(),
        text(""),
        text("More detail"),
      ]),
    ).toBe("Real question More detail");
  });

  it("builds a prompt from only the first user message text", () => {
    const prompt = buildTitlePromptText([
      text("  Real\nquestion  "),
      reasoning("private thought"),
      search(),
      text("More detail"),
    ]);

    expect(prompt).toContain(
      "<user_message>\nReal question More detail\n</user_message>",
    );
    expect(prompt).not.toContain("Assistant:");
    expect(prompt).not.toContain("private thought");
    expect(prompt).not.toContain("hidden query");
  });

  it("does nothing when the persisted chat already has a title", async () => {
    mocks.getChatTitleContext.mockResolvedValue({
      title: "Existing title",
      firstUserParts,
    });

    await expect(
      ensureChatTitle({
        chatId: "chat",
        userId: "user",
        fallbackModelConfig: modelConfig,
      }),
    ).resolves.toBeNull();

    expect(mocks.getTaskModelConfig).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("uses a dedicated task model even when it is hidden from chat", async () => {
    const hiddenTaskModel = {
      ...modelConfig,
      model: "hidden-task-model",
      enabled: false,
      taskModel: true,
    };
    mocks.getTaskModelConfig.mockReturnValue(hiddenTaskModel);

    await ensureChatTitle({
      chatId: "chat",
      userId: "user",
      fallbackModelConfig: modelConfig,
    });

    expect(mocks.createConfiguredLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "hidden-task-model" }),
    );
  });

  it("does nothing without a task model or chat-model fallback", async () => {
    await expect(
      ensureChatTitle({
        chatId: "chat",
        userId: "user",
        fallbackModelConfig: null,
      }),
    ).resolves.toBeNull();

    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("returns null without calling the model when first-user text is empty", async () => {
    mocks.getChatTitleContext.mockResolvedValue({
      title: null,
      firstUserParts: [reasoning("private thought"), search(), file(), text(" ")],
    });

    const title = await ensureChatTitle({
      chatId: "chat",
      userId: "user",
      fallbackModelConfig: modelConfig,
    });

    expect(title).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.setTitleIfNull).not.toHaveBeenCalled();
  });

  it("persists a successful generated title", async () => {
    mocks.generateText.mockResolvedValue(
      generationResult('"Dependency Cleanup!"'),
    );

    const title = await ensureChatTitle({
      chatId: "chat",
      userId: "user",
      fallbackModelConfig: modelConfig,
    });

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        prompt: expect.stringContaining("<user_message>"),
        providerOptions: { custom: { reasoningEffort: "none" } },
      }),
    );
    expect(mocks.generateText.mock.calls[0][0]).not.toHaveProperty(
      "maxOutputTokens",
    );
    expect(mocks.setTitleIfNull).toHaveBeenCalledWith(
      "chat",
      "Dependency Cleanup",
    );
    expect(mocks.tryRecordGenerationUsage).toHaveBeenCalledWith({
      id: expect.any(String),
      userId: "user",
      chatId: "chat",
      context: "title",
      occurredAt: expect.any(Date),
      providerId: "custom",
      model: "title-model",
      inputTokens: 10,
      uncachedInputTokens: 4,
      outputTokens: 2,
      cacheReadTokens: 6,
      cacheWriteTokens: 1,
      totalTokens: 12,
      finishReason: "stop",
    });
    expect(title).toBe("Dependency Cleanup");
  });

  it("persists the historical cost estimate with title usage", async () => {
    mocks.generateText.mockResolvedValue(
      generationResult("Priced Title"),
    );

    await ensureChatTitle({
      chatId: "chat",
      userId: "user",
      fallbackModelConfig: {
        ...modelConfig,
        providerId: "anthropic",
        apiFormat: "auto",
        model: "claude-sonnet-4-6",
      },
    });

    expect(mocks.tryRecordGenerationUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "anthropic",
        model: "claude-sonnet-4-6",
        costSource: "models.dev",
        inputCostNanoUsd: 12_000,
        outputCostNanoUsd: 30_000,
        cacheReadCostNanoUsd: 1_800,
        cacheWriteCostNanoUsd: 3_750,
        totalCostNanoUsd: 47_550,
      }),
    );
  });

  it("uses configured pricing for title usage", async () => {
    mocks.generateText.mockResolvedValue(
      generationResult("Configured Price"),
    );

    await ensureChatTitle({
      chatId: "chat",
      userId: "user",
      fallbackModelConfig: {
        ...modelConfig,
        pricing: {
          input: 2,
          output: 8,
          cacheRead: 0.2,
          cacheWrite: 2.5,
        },
      },
    });

    expect(mocks.tryRecordGenerationUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        costSource: "model_config",
        inputCostNanoUsd: 8_000,
        outputCostNanoUsd: 16_000,
        cacheReadCostNanoUsd: 1_200,
        cacheWriteCostNanoUsd: 2_500,
        totalCostNanoUsd: 27_700,
      }),
    );
  });

  it("preserves saved provider options while disabling reasoning", async () => {
    mocks.createConfiguredLanguageModel.mockReturnValue({
      model: "model",
      providerOptions: { custom: { user: "saved-user" } },
      providerOptionsKey: "custom",
    });

    await ensureChatTitle({
      chatId: "chat",
      userId: "user",
      fallbackModelConfig: modelConfig,
    });

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          custom: { user: "saved-user", reasoningEffort: "none" },
        },
      }),
    );
  });

  it("does not persist anything when generation fails", async () => {
    const err = new Error("provider down");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.generateText.mockRejectedValue(err);

    const title = await ensureChatTitle({
      chatId: "chat",
      userId: "user",
      fallbackModelConfig: modelConfig,
    });

    expect(title).toBeNull();
    expect(mocks.setTitleIfNull).not.toHaveBeenCalled();
    expect(mocks.tryRecordGenerationUsage).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("[title-generation]", err);
    consoleSpy.mockRestore();
  });

  it("does not persist anything when model construction fails", async () => {
    const err = new Error("invalid saved configuration");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createConfiguredLanguageModel.mockImplementation(() => {
      throw err;
    });

    const title = await ensureChatTitle({
      chatId: "chat",
      userId: "user",
      fallbackModelConfig: modelConfig,
    });

    expect(title).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.setTitleIfNull).not.toHaveBeenCalled();
    expect(mocks.tryRecordGenerationUsage).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("[title-generation]", err);
    consoleSpy.mockRestore();
  });

  it("records usage without persisting an empty generated title", async () => {
    mocks.generateText.mockResolvedValue(generationResult("..."));

    const title = await ensureChatTitle({
      chatId: "chat",
      userId: "user",
      fallbackModelConfig: modelConfig,
    });

    expect(title).toBeNull();
    expect(mocks.setTitleIfNull).not.toHaveBeenCalled();
    expect(mocks.tryRecordGenerationUsage).toHaveBeenCalledOnce();
  });

  it("does not return a title when the conditional DB write loses a race", async () => {
    mocks.generateText.mockResolvedValue(
      generationResult("Generated title"),
    );
    mocks.setTitleIfNull.mockResolvedValue(null);

    const title = await ensureChatTitle({
      chatId: "chat",
      userId: "user",
      fallbackModelConfig: modelConfig,
    });

    expect(title).toBeNull();
    expect(mocks.setTitleIfNull).toHaveBeenCalledWith(
      "chat",
      "Generated title",
    );
  });
});
