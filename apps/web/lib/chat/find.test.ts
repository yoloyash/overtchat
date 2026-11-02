import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  chatFindSegments,
  collectChatFindMatches,
  findOccurrences,
  initialChatFindIndex,
  resolveChatFindIndex,
  stepChatFindIndex,
} from "./find";

function message(
  id: string,
  role: UIMessage["role"],
  text: string,
  metadata?: unknown,
): UIMessage {
  return { id, role, parts: [{ type: "text", text }], metadata };
}

describe("chat find text", () => {
  it("searches rendered markdown text instead of its syntax", () => {
    const segments = chatFindSegments(
      message(
        "a",
        "assistant",
        [
          "## Setup **steps**",
          "",
          "Read the [install guide](https://example.com/guide) and run `npm ci`.",
          "",
          "- first item",
          "- second item",
          "",
          "```ts",
          "const total = 2;",
          "```",
        ].join("\n"),
      ),
    );

    expect(segments).toEqual([
      "Setup steps",
      "Read the install guide and run npm ci.",
      "first item",
      "second item",
      "const total = 2;",
    ]);
  });

  it("leaves out math, rendered diagrams and previews, and citation markers", () => {
    const segments = chatFindSegments(
      message(
        "a",
        "assistant",
        [
          "Energy is $$E = mc^2$$ here. turn0search0",
          "",
          "```mermaid",
          "graph TD; hidden-node",
          "```",
          "",
          "```html",
          "<p>hidden-markup</p>",
          "```",
        ].join("\n"),
      ),
    );

    expect(segments.join(" ")).toContain("Energy is");
    expect(segments.join(" ")).not.toMatch(/mc|hidden|turn0/);
  });

  it("keeps user text literal, so markdown characters are searchable", () => {
    expect(
      chatFindSegments(message("u", "user", "Why is **this**\nbold?")),
    ).toEqual(["Why is **this** bold?"]);
  });

  it("does not search reasoning, tools, or manual compaction notes", () => {
    const withReasoning: UIMessage = {
      id: "r",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "secret plan" },
        { type: "text", text: "Visible answer" },
      ],
    };
    expect(chatFindSegments(withReasoning)).toEqual(["Visible answer"]);
    expect(
      chatFindSegments(
        message("c", "assistant", "Summary", { contextStatus: "manual-compacted" }),
      ),
    ).toEqual([]);
  });
});

describe("chat find matches", () => {
  it("matches case-insensitively without overlapping", () => {
    expect(findOccurrences("Aaa aA", "aa")).toEqual([0, 4]);
    expect(findOccurrences("anything", "")).toEqual([]);
  });

  it("numbers occurrences within each message in order", () => {
    const matches = collectChatFindMatches(
      [
        message("one", "user", "Cats and cats"),
        message("two", "assistant", "No match"),
        message("three", "assistant", "First cat.\n\nSecond **cat**."),
      ],
      "cat",
    );

    expect(matches).toEqual([
      { messageId: "one", messageIndex: 0, occurrence: 0 },
      { messageId: "one", messageIndex: 0, occurrence: 1 },
      { messageId: "three", messageIndex: 2, occurrence: 0 },
      { messageId: "three", messageIndex: 2, occurrence: 1 },
    ]);
  });

  it("lets a message's rendered count replace its predicted count", () => {
    const messages = [
      message("one", "user", "cat"),
      message("two", "assistant", "cat cat"),
    ];
    const matches = collectChatFindMatches(messages, "cat", (m) =>
      m.id === "two" ? 1 : undefined,
    );
    expect(matches.map(({ messageId }) => messageId)).toEqual(["one", "two"]);
  });

  it("keeps a selection whose message lost occurrences on its last one", () => {
    const matches = [
      { messageId: "a", messageIndex: 0, occurrence: 0 },
      { messageId: "b", messageIndex: 1, occurrence: 0 },
      { messageId: "b", messageIndex: 1, occurrence: 1 },
    ];
    expect(resolveChatFindIndex(matches, { messageId: "b", occurrence: 1 })).toBe(2);
    expect(resolveChatFindIndex(matches, { messageId: "b", occurrence: 4 })).toBe(2);
    expect(resolveChatFindIndex(matches, { messageId: "c", occurrence: 0 })).toBe(-1);
  });

  it("does not match a phrase across rendered paragraphs", () => {
    expect(
      collectChatFindMatches(
        [message("a", "assistant", "ends here\n\nnext paragraph")],
        "here next",
      ),
    ).toEqual([]);
  });

  it("starts at the first match in view, else the closest one above", () => {
    const matches = [0, 2, 5].map((messageIndex) => ({
      messageId: String(messageIndex),
      messageIndex,
      occurrence: 0,
    }));
    expect(initialChatFindIndex(matches, 1)).toBe(1);
    expect(initialChatFindIndex(matches, 5)).toBe(2);
    expect(initialChatFindIndex(matches, 9)).toBe(2);
    expect(initialChatFindIndex([], 0)).toBe(-1);
  });

  it("wraps when stepping past either end", () => {
    expect(stepChatFindIndex(2, 3, 1)).toBe(0);
    expect(stepChatFindIndex(0, 3, -1)).toBe(2);
    expect(stepChatFindIndex(-1, 3, 1)).toBe(0);
    expect(stepChatFindIndex(-1, 3, -1)).toBe(2);
    expect(stepChatFindIndex(0, 0, 1)).toBe(-1);
  });
});
