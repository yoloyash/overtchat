import { convertToModelMessages, type UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchReadable: vi.fn(),
  searchWeb: vi.fn(),
  storeFetchedImage: vi.fn(),
  readFetchedImage: vi.fn(),
}));

vi.mock("./web", () => ({
  fetchReadable: mocks.fetchReadable,
  searchWeb: mocks.searchWeb,
}));
vi.mock("@/lib/db/uploads", () => ({
  storeFetchedImage: mocks.storeFetchedImage,
  readFetchedImage: mocks.readFetchedImage,
}));

import { createWebTools, WEB_SEARCH_CITATION_PROMPT } from "./tools";

const executionOptions = {
  toolCallId: "tool-call",
  messages: [],
  abortSignal: undefined,
  context: {},
};

describe("native web tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards text offsets and preserves continuation metadata", async () => {
    const page = {
      kind: "text" as const,
      url: "https://example.com/report.pdf",
      title: "Report",
      content: "second chunk",
      wordCount: 12_000,
      contentType: "application/pdf",
      extractor: "unpdf",
      startIndex: 8_000,
      returnedChars: 12,
      totalChars: 30_000,
      truncated: true,
      nextStartIndex: 8_012,
      pageCount: 30,
      metadata: { author: "Example" },
      links: ["https://example.com/reference"],
    };
    mocks.fetchReadable.mockResolvedValue(page);
    const tools = createWebTools({
      userId: "user-id",
      supportsImageInput: true,
    });

    const output = await tools.fetch_url.execute!(
      { url: page.url, startIndex: 8_000 },
      executionOptions,
    );

    expect(mocks.fetchReadable).toHaveBeenCalledWith(page.url, {
      startIndex: 8_000,
      signal: undefined,
    });
    expect(output).toEqual(page);
    await expect(
      tools.fetch_url.toModelOutput!({
        toolCallId: "tool-call",
        input: { url: page.url, startIndex: 8_000 },
        output: page,
      }),
    ).resolves.toEqual({
      type: "json",
      value: page,
    });
  });

  it("persists fetched images without putting bytes in the tool output", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    mocks.fetchReadable.mockResolvedValue({
      kind: "image",
      url: "https://example.com/photo.png",
      data,
      byteLength: data.byteLength,
      contentType: "image/png",
      extractor: "image",
    });
    mocks.storeFetchedImage.mockResolvedValue({
      uploadUrl: "/api/uploads/image-id",
    });
    const tools = createWebTools({
      userId: "user-id",
      supportsImageInput: true,
    });

    const output = await tools.fetch_url.execute!(
      { url: "https://example.com/photo.png" },
      executionOptions,
    );

    expect(mocks.storeFetchedImage).toHaveBeenCalledWith({
      userId: "user-id",
      filename: "photo.png",
      mediaType: "image/png",
      data,
    });
    expect(output).toEqual({
      kind: "image",
      url: "https://example.com/photo.png",
      uploadUrl: "/api/uploads/image-id",
      filename: "photo.png",
      contentType: "image/png",
      byteLength: 4,
    });
    expect(output).not.toHaveProperty("data");
  });

  it("loads persisted image bytes only when preparing model output", async () => {
    const data = new Uint8Array([5, 6, 7]);
    mocks.readFetchedImage.mockResolvedValue({
      data,
      filename: "photo.png",
      mediaType: "image/png",
    });
    const tools = createWebTools({
      userId: "user-id",
      supportsImageInput: true,
    });
    const output = {
      kind: "image" as const,
      url: "https://example.com/photo.png",
      uploadUrl: "/api/uploads/image-id",
      filename: "photo.png",
      contentType: "image/png",
      byteLength: 3,
    };

    await expect(
      tools.fetch_url.toModelOutput!({
        toolCallId: "tool-call",
        input: { url: output.url },
        output,
      }),
    ).resolves.toEqual({
      type: "content",
      value: [
        {
          type: "text",
          text: "Image fetched from https://example.com/photo.png. Inspect the attached image.",
        },
        {
          type: "file",
          mediaType: "image/png",
          filename: "photo.png",
          data: { type: "data", data },
        },
      ],
    });
    expect(mocks.readFetchedImage).toHaveBeenCalledWith(
      "/api/uploads/image-id",
      "user-id",
    );
  });

  it("replays a persisted image through AI SDK message conversion", async () => {
    const data = new Uint8Array([8, 9, 10]);
    mocks.readFetchedImage.mockResolvedValue({
      data,
      filename: "photo.png",
      mediaType: "image/png",
    });
    const tools = createWebTools({
      userId: "user-id",
      supportsImageInput: true,
    });
    const history: UIMessage[] = [
      {
        id: "assistant-message",
        role: "assistant",
        parts: [
          {
            type: "tool-fetch_url",
            toolCallId: "tool-call",
            state: "output-available",
            input: { url: "https://example.com/photo.png" },
            output: {
              kind: "image",
              url: "https://example.com/photo.png",
              uploadUrl: "/api/uploads/image-id",
              filename: "photo.png",
              contentType: "image/png",
              byteLength: 3,
            },
          },
        ],
      },
    ];

    const converted = await convertToModelMessages(history, { tools });
    expect(converted).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tool-call",
            toolName: "fetch_url",
            input: { url: "https://example.com/photo.png" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-call",
            toolName: "fetch_url",
            output: {
              type: "content",
              value: [
                {
                  type: "text",
                  text: "Image fetched from https://example.com/photo.png. Inspect the attached image.",
                },
                {
                  type: "file",
                  mediaType: "image/png",
                  filename: "photo.png",
                  data: { type: "data", data },
                },
              ],
            },
          },
        ],
      },
    ]);
  });

  it("drops every incomplete persisted tool state before model conversion", async () => {
    const incompleteIds = [
      "input-streaming",
      "input-available",
      "approval-requested",
      "missing-state",
      "preliminary-output",
    ];
    const history: UIMessage[] = [
      {
        id: "interrupted-assistant",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "interrupted_tool",
            toolCallId: "input-streaming",
            state: "input-streaming",
            input: {},
          },
          {
            type: "dynamic-tool",
            toolName: "interrupted_tool",
            toolCallId: "input-available",
            state: "input-available",
            input: {},
          },
          {
            type: "dynamic-tool",
            toolName: "interrupted_tool",
            toolCallId: "approval-requested",
            state: "approval-requested",
            input: {},
            approval: { id: "approval" },
          },
          {
            type: "dynamic-tool",
            toolName: "interrupted_tool",
            toolCallId: "missing-state",
            input: {},
          } as unknown as UIMessage["parts"][number],
          {
            type: "dynamic-tool",
            toolName: "interrupted_tool",
            toolCallId: "preliminary-output",
            state: "output-available",
            input: {},
            output: "partial",
            preliminary: true,
          },
          {
            type: "dynamic-tool",
            toolName: "interrupted_tool",
            toolCallId: "settled-error",
            state: "output-error",
            input: {},
            errorText: "tool failed",
          },
        ],
      },
      {
        id: "next-user",
        role: "user",
        parts: [{ type: "text", text: "Continue" }],
      },
    ];

    const converted = await convertToModelMessages(history, {
      ignoreIncompleteToolCalls: true,
    });
    const serialized = JSON.stringify(converted);

    for (const toolCallId of incompleteIds) {
      expect(serialized).not.toContain(toolCallId);
    }
    expect(serialized).toContain("settled-error");
    expect(converted.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "Continue" }],
    });
  });

  it("fails before persistence for an explicitly text-only model", async () => {
    mocks.fetchReadable.mockResolvedValue({
      kind: "image",
      url: "https://example.com/photo.png",
      data: new Uint8Array([1]),
      byteLength: 1,
      contentType: "image/png",
      extractor: "image",
    });
    const tools = createWebTools({
      userId: "user-id",
      supportsImageInput: false,
    });

    await expect(
      tools.fetch_url.execute!(
        { url: "https://example.com/photo.png" },
        executionOptions,
      ),
    ).rejects.toThrow("selected model does not support image input");
    expect(mocks.storeFetchedImage).not.toHaveBeenCalled();
  });

  it("does not replay a historical image into a text-only model", async () => {
    const tools = createWebTools({
      userId: "user-id",
      supportsImageInput: false,
    });

    await expect(
      tools.fetch_url.toModelOutput!({
        toolCallId: "tool-call",
        input: { url: "https://example.com/photo.png" },
        output: {
          kind: "image",
          url: "https://example.com/photo.png",
          uploadUrl: "/api/uploads/image-id",
          filename: "photo.png",
          contentType: "image/png",
          byteLength: 3,
        },
      }),
    ).resolves.toEqual({
      type: "error-text",
      value: "The selected model does not support image input.",
    });
    expect(mocks.readFetchedImage).not.toHaveBeenCalled();
  });

  it("degrades a missing historical fetched image to a tool error", async () => {
    mocks.readFetchedImage.mockResolvedValue(null);
    const tools = createWebTools({
      userId: "user-id",
      supportsImageInput: true,
    });

    await expect(
      tools.fetch_url.toModelOutput!({
        toolCallId: "tool-call",
        input: { url: "https://example.com/photo.png" },
        output: {
          kind: "image",
          url: "https://example.com/photo.png",
          uploadUrl: "/api/uploads/missing",
          filename: "photo.png",
          contentType: "image/png",
          byteLength: 3,
        },
      }),
    ).resolves.toEqual({
      type: "error-text",
      value: "The fetched image is no longer available.",
    });
  });
});

describe("WEB_SEARCH_CITATION_PROMPT", () => {
  it("documents every rendered citation form with literal markers", () => {
    expect(WEB_SEARCH_CITATION_PROMPT).toContain("Web search:\n");
    expect(WEB_SEARCH_CITATION_PROMPT).toContain(
      "Cite every non-obvious factual claim derived from web_search results",
    );
    expect(WEB_SEARCH_CITATION_PROMPT).toContain("\\ue202turn0search0");
    expect(WEB_SEARCH_CITATION_PROMPT).toContain("\\ue202turn1search3");
    expect(WEB_SEARCH_CITATION_PROMPT).toContain(
      "\\ue202turn0search0\\ue202turn0search1",
    );
    expect(WEB_SEARCH_CITATION_PROMPT).toContain(
      "\\ue200\\ue202turn0search0\\ue202turn0search1\\ue201",
    );
    expect(WEB_SEARCH_CITATION_PROMPT).toContain(
      "\\ue203Cited text.\\ue204\\ue202turn0search0",
    );
    expect(WEB_SEARCH_CITATION_PROMPT).not.toContain("\\ue202turn{");
    expect(WEB_SEARCH_CITATION_PROMPT).not.toMatch(/[\uE200-\uE204]/);
  });
});
