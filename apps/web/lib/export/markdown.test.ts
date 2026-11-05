import { describe, expect, it } from "vitest";
import type { ExportedChat, ExportedMessage } from "./index";
import { chatToMarkdown } from "./markdown";

const options = {
  timeZone: "America/New_York",
  exportedAt: "2026-11-05T18:20:00.000Z",
};

function chat(messages: ExportedMessage[], title: string | null = "Trip plan"): ExportedChat {
  return {
    id: "chat",
    title,
    kind: "text",
    createdAt: "2026-11-05T17:00:00.000Z",
    updatedAt: "2026-11-05T17:05:00.000Z",
    messages,
  };
}

function message(
  id: string,
  role: ExportedMessage["role"],
  parts: unknown[],
  metadata?: Record<string, unknown>,
): ExportedMessage {
  return {
    id,
    role,
    parts,
    ...(metadata ? { metadata } : {}),
    createdAt: "2026-11-05T17:03:00.000Z",
  };
}

describe("chatToMarkdown", () => {
  it("writes each turn under a heading with its local time and model", () => {
    const markdown = chatToMarkdown(
      chat([
        message("q", "user", [{ type: "text", text: "Where should I go?" }]),
        message(
          "a",
          "assistant",
          [
            { type: "step-start" },
            { type: "reasoning", text: "Thinking about beaches." },
            { type: "text", text: "## Options\n\n- Lisbon\n- Porto" },
          ],
          { stats: { model: "test-model" } },
        ),
      ]),
      options,
    );

    expect(markdown).toBe(
      [
        "# Trip plan",
        "*Exported on 2026-11-05 13:20. Times are in America/New_York.*",
        "## You",
        "*2026-11-05 12:03*",
        "Where should I go?",
        "## Assistant",
        "*2026-11-05 12:03 · test-model*",
        "## Options\n\n- Lisbon\n- Porto",
      ].join("\n\n") + "\n",
    );
  });

  it("turns citation markers into numbered links and lists the sources", () => {
    const markdown = chatToMarkdown(
      chat([
        message("a", "assistant", [
          {
            type: "tool-web_search",
            toolCallId: "search",
            state: "output-available",
            input: { query: "lisbon weather" },
            output: [
              {
                link: "https://example.com/weather_(lisbon)",
                title: "Lisbon [weather]",
                snippet: "Mild.",
              },
              { link: "https://example.org/b", title: "", snippet: "" },
            ],
          },
          {
            type: "text",
            text: "It is mildturn0search0 all year \\ue202turn0search1 and dryturn9search9.",
          },
        ]),
      ]),
      options,
    );

    expect(markdown).toContain(
      "It is mild [1](https://example.com/weather_%28lisbon%29) all year [2](https://example.org/b) and dry.",
    );
    expect(markdown).toContain(
      [
        "**Sources**",
        "",
        "1. [Lisbon \\[weather\\]](https://example.com/weather_%28lisbon%29)",
        "2. [https://example.org/b](https://example.org/b)",
      ].join("\n"),
    );
    expect(markdown).not.toMatch(/|\\ue202/);
  });

  it("notes attachments, documents, images and interactive views in place", () => {
    const markdown = chatToMarkdown(
      chat([
        message("q", "user", [
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "plan_v2.pdf",
            url: "/api/uploads/file",
          },
          { type: "text", text: "Summarise this." },
        ]),
        message("a", "assistant", [
          { type: "text", text: "Before the document." },
          {
            type: "tool-create_document",
            toolCallId: "doc",
            state: "output-available",
            output: {
              id: "doc-1",
              title: "Summary",
              type: "markdown",
              version: 2,
              content: "Not exported.",
            },
          },
          {
            type: "tool-generate_image",
            toolCallId: "image",
            state: "output-available",
            output: { images: [], prompt: "A tram\nin Lisbon", model: "m" },
          },
          {
            type: "tool-present_openui",
            toolCallId: "ui",
            state: "output-available",
            output: { text: "| City | Days |\n| --- | --- |\n| Lisbon | 3 |" },
          },
          { type: "tool-present_openui", toolCallId: "ui-2", state: "output-available" },
          { type: "text", text: "After everything." },
        ]),
      ]),
      options,
    );

    expect(markdown).toContain(
      "*Attachment: plan\\_v2.pdf*\n\nSummarise this.",
    );
    expect(markdown).toContain(
      [
        "Before the document.",
        "*Document: Summary (version 2)*",
        "*Generated image: A tram in Lisbon*",
        "| City | Days |\n| --- | --- |\n| Lisbon | 3 |",
        "*Interactive view*",
        "After everything.",
      ].join("\n\n"),
    );
    expect(markdown).not.toContain("Not exported.");
  });

  it("leaves out system prompts, compaction markers and turns with nothing to read", () => {
    const markdown = chatToMarkdown(
      chat(
        [
          message("s", "system", [{ type: "text", text: "Be brief." }]),
          message("q", "user", [{ type: "text", text: "Hello" }]),
          message(
            "c",
            "assistant",
            [{ type: "text", text: "Summary of earlier turns." }],
            { contextStatus: "manual-compacted" },
          ),
          message("t", "assistant", [
            {
              type: "tool-fetch_url",
              toolCallId: "fetch",
              state: "output-available",
              output: "page text",
            },
          ]),
          message("bad", "assistant", "not parts" as unknown as unknown[]),
        ],
        null,
      ),
      { ...options, timeZone: "UTC" },
    );

    expect(markdown).toBe(
      [
        "# Untitled chat",
        "*Exported on 2026-11-05 18:20. Times are in UTC.*",
        "## You",
        "*2026-11-05 17:03*",
        "Hello",
      ].join("\n\n") + "\n",
    );
  });

  it("keeps a title from breaking out of its heading", () => {
    expect(
      chatToMarkdown(chat([], "Plan *A*\nand [B]"), options).split("\n")[0],
    ).toBe("# Plan \\*A\\* and \\[B\\]");
  });
});
