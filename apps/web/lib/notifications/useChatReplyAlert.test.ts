import { describe, expect, it } from "vitest";
import { chatReplyPreview } from "./useChatReplyAlert";

describe("a chat reply's notification text", () => {
  it("keeps only the visible answer, on one line", () => {
    expect(
      chatReplyPreview([
        { type: "reasoning", text: "Thinking it over." },
        { type: "text", text: "Here is\n\nthe  answer." },
        { type: "tool-search", text: "hidden" },
        { type: "text", text: "And more." },
      ]),
    ).toBe("Here is the answer. And more.");
    expect(chatReplyPreview([{ type: "file" }])).toBe("");
  });

  it("cuts a long reply to a glance", () => {
    const preview = chatReplyPreview([{ type: "text", text: "word ".repeat(100) }]);
    expect(preview).toHaveLength(160);
    expect(preview.endsWith("…")).toBe(true);
  });
});
