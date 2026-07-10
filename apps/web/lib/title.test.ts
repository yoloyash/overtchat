import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";

const mocks = vi.hoisted(() => ({
  buildModel: vi.fn(),
  generateText: vi.fn(),
  setTitleIfNull: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("@/lib/db/chats", () => ({
  setTitleIfNull: mocks.setTitleIfNull,
}));
vi.mock("@/lib/llm", () => ({ buildModel: mocks.buildModel }));

import {
  buildTitlePromptText,
  cleanGeneratedTitle,
  extractTextForTitle,
  generateChatTitle,
} from "./title";

type Part = UIMessage["parts"][number];

const modelConfig = {
  baseUrl: "http://example.test/v1",
  apiKey: "key",
  model: "title-model",
  extraBody: null,
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

describe("title helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildModel.mockReturnValue({
      model: "model",
      providerOptions: { "openai-compatible": {} },
    });
    mocks.generateText.mockResolvedValue({ text: "Server Owned Titles" });
    mocks.setTitleIfNull.mockImplementation(async (_chatId, title) => title);
  });

  it("cleans generated title output", () => {
    expect(cleanGeneratedTitle('  " Fix title generation!!! "  ')).toBe(
      "Fix title generation",
    );
    expect(cleanGeneratedTitle("Line one\n\tline two.")).toBe("Line one line two");
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

    expect(prompt).toContain("User:\nReal question More detail");
    expect(prompt).not.toContain("Assistant:");
    expect(prompt).not.toContain("private thought");
    expect(prompt).not.toContain("hidden query");
  });

  it("returns null without calling the model when first-user text is empty", async () => {
    const title = await generateChatTitle({
      chatId: "chat",
      modelConfig,
      userParts: [reasoning("private thought"), search(), file(), text(" ")],
    });

    expect(title).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.setTitleIfNull).not.toHaveBeenCalled();
  });

  it("persists a successful generated title", async () => {
    mocks.generateText.mockResolvedValue({ text: '"Dependency Cleanup!"' });

    const title = await generateChatTitle({
      chatId: "chat",
      modelConfig,
      userParts: firstUserParts,
    });

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        prompt: expect.stringContaining("User:"),
      }),
    );
    expect(mocks.generateText.mock.calls[0][0]).not.toHaveProperty(
      "maxOutputTokens",
    );
    expect(mocks.setTitleIfNull).toHaveBeenCalledWith(
      "chat",
      "Dependency Cleanup",
    );
    expect(title).toBe("Dependency Cleanup");
  });

  it("does not persist anything when generation fails", async () => {
    const err = new Error("provider down");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.generateText.mockRejectedValue(err);

    const title = await generateChatTitle({
      chatId: "chat",
      modelConfig,
      userParts: firstUserParts,
    });

    expect(title).toBeNull();
    expect(mocks.setTitleIfNull).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("[title-generation]", err);
    consoleSpy.mockRestore();
  });

  it("does not persist empty generated output", async () => {
    mocks.generateText.mockResolvedValue({ text: "..." });

    const title = await generateChatTitle({
      chatId: "chat",
      modelConfig,
      userParts: firstUserParts,
    });

    expect(title).toBeNull();
    expect(mocks.setTitleIfNull).not.toHaveBeenCalled();
  });

  it("does not return a title when the conditional DB write loses a race", async () => {
    mocks.generateText.mockResolvedValue({ text: "Generated title" });
    mocks.setTitleIfNull.mockResolvedValue(null);

    const title = await generateChatTitle({
      chatId: "chat",
      modelConfig,
      userParts: firstUserParts,
    });

    expect(title).toBeNull();
    expect(mocks.setTitleIfNull).toHaveBeenCalledWith("chat", "Generated title");
  });
});
