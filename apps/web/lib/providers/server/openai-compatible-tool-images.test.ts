import type { LanguageModelV4Prompt } from "@ai-sdk/provider";
import { convertToOpenAICompatibleChatMessages } from "@ai-sdk/openai-compatible/internal";
import { describe, expect, it } from "vitest";
import { promoteToolResultImages } from "./openai-compatible-tool-images";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

function imageResult(
  toolCallId: string,
  text?: string,
): LanguageModelV4Prompt[number] {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName: "fetch_url",
        output: {
          type: "content",
          value: [
            ...(text ? [{ type: "text" as const, text }] : []),
            {
              type: "file",
              filename: "image.png",
              mediaType: "image/png",
              data: { type: "data", data: PNG_BASE64 },
            },
          ],
        },
      },
    ],
  };
}

describe("OpenAI-compatible tool-result images", () => {
  it("keeps tool content textual and promotes the image to a user message", () => {
    const converted = promoteToolResultImages([
      imageResult("call-1", "Image fetched successfully."),
    ]);

    expect(converted).toEqual([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "fetch_url",
            output: {
              type: "text",
              value: "Image fetched successfully.",
            },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Attached image(s) from tool result:" },
          {
            type: "file",
            filename: "image.png",
            mediaType: "image/png",
            data: { type: "data", data: PNG_BASE64 },
          },
        ],
      },
    ]);

    expect(JSON.stringify(converted[0])).not.toContain(PNG_BASE64);
  });

  it("produces the spec-compliant Chat Completions wire shape", () => {
    const converted = promoteToolResultImages([
      imageResult("call-1", "Image fetched successfully."),
    ]);
    const wireMessages = convertToOpenAICompatibleChatMessages(converted);

    expect(wireMessages).toEqual([
      {
        role: "tool",
        tool_call_id: "call-1",
        content: "Image fetched successfully.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Attached image(s) from tool result:" },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${PNG_BASE64}`,
            },
          },
        ],
      },
    ]);
  });

  it("uses a textual pointer when the tool result contains only an image", () => {
    const converted = promoteToolResultImages([imageResult("call-1")]);
    const toolMessage = converted[0];

    expect(toolMessage.role).toBe("tool");
    if (toolMessage.role !== "tool") throw new Error("Expected tool message");
    expect(toolMessage.content[0]).toMatchObject({
      type: "tool-result",
      output: { type: "text", value: "(see attached image)" },
    });
  });

  it("batches images from consecutive tool messages", () => {
    const converted = promoteToolResultImages([
      imageResult("call-1", "First"),
      imageResult("call-2", "Second"),
    ]);

    expect(converted.map((message) => message.role)).toEqual([
      "tool",
      "tool",
      "user",
    ]);
    const imageMessage = converted[2];
    expect(imageMessage.role).toBe("user");
    if (imageMessage.role !== "user") throw new Error("Expected user message");
    expect(imageMessage.content.filter((part) => part.type === "file")).toHaveLength(
      2,
    );
  });

  it("omits image bytes for a model without vision support", () => {
    const converted = promoteToolResultImages(
      [imageResult("call-1", "Fetched an image.")],
      false,
    );

    expect(converted).toHaveLength(1);
    expect(JSON.stringify(converted)).not.toContain(PNG_BASE64);
    expect(converted[0]).toMatchObject({
      role: "tool",
      content: [
        {
          output: {
            type: "text",
            value:
              "Fetched an image.\n[image omitted: model does not support vision]",
          },
        },
      ],
    });
  });

  it("leaves ordinary tool outputs unchanged", () => {
    const prompt: LanguageModelV4Prompt = [
      { role: "user", content: [{ type: "text", text: "Search" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "web_search",
            output: {
              type: "json",
              value: { results: [{ title: "Example" }] },
            },
          },
        ],
      },
    ];

    expect(promoteToolResultImages(prompt)).toEqual(prompt);
  });

  it("normalizes text-only rich content without adding a user message", () => {
    const converted = promoteToolResultImages([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "read",
            output: {
              type: "content",
              value: [{ type: "text", text: "File contents" }],
            },
          },
        ],
      },
    ]);

    expect(converted).toEqual([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "read",
            output: { type: "text", value: "File contents" },
          },
        ],
      },
    ]);
  });
});
