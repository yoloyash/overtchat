import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "@overtchat/shared";
import { chatReplyPreview } from "./preview";

describe("a chat reply's notification text", () => {
  it("keeps only the visible answer, on one line", () => {
    expect(
      chatReplyPreview(
        [
          { type: "reasoning", text: "Thinking it over." },
          { type: "text", text: "Here is\n\nthe  answer." },
          { type: "tool-search", text: "hidden" },
          { type: "text", text: "And more." },
        ],
        160,
      ),
    ).toBe("Here is the answer. And more.");
    expect(chatReplyPreview([{ type: "file" }], 160)).toBe("");
  });

  it("shows Markdown as the text a reader sees, without citation anchors", () => {
    expect(
      chatReplyPreview(
        [
          {
            type: "text",
            text: "## Summary\n\n**Rust 2.0** shipped today.\ue202turn0search0 See [the notes](https://example.com).",
          },
        ],
        160,
      ),
    ).toBe("Summary Rust 2.0 shipped today. See the notes.");
  });

  it("cuts a long reply to the limit", () => {
    const preview = chatReplyPreview([{ type: "text", text: "word ".repeat(100) }], 160);
    expect(preview).toHaveLength(160);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("Markdown as plain text", () => {
  it.each([
    ["# Title\n### Sub", "Title\nSub"],
    ["**bold**, *italic*, __strong__, _em_, ~~gone~~ and ***both***", "bold, italic, strong, em, gone and both"],
    ["- one\n* two\n+ three\n1. four\n2) five", "one\ntwo\nthree\nfour\nfive"],
    ["- [ ] todo\n- [x] done", "todo\ndone"],
    ["> quoted\n> > nested", "quoted\nnested"],
    ["[link](https://a.b \"title\") and ![alt](i.png) and <https://c.d>", "link and alt and https://c.d"],
    ["Before\n\n---\n\n***\n\nAfter", "Before\n\n\n\n\n\nAfter"],
    ["| Model | Price |\n| --- | ---: |\n| A | $1 |", "Model Price\n\nA $1"],
    ["Line<br>break and <sup>2</sup>", "Line break and  2"],
  ])("reads %j as plain text", (markdown, text) => {
    expect(markdownToPlainText(markdown)).toBe(text);
  });

  it("keeps code exactly, without its fences or backticks", () => {
    expect(markdownToPlainText("Run `__init__.py` or `` a`b ``:\n```py\n# **kwargs\ndef f(**kwargs): pass\n```\nDone.")).toBe(
      "Run __init__.py or a`b:\n# **kwargs\ndef f(**kwargs): pass\n\nDone.",
    );
  });

  it("keeps an unclosed fence's code, as a reply cut off mid-block", () => {
    expect(markdownToPlainText("Here:\n```ts\nconst a = 1;")).toBe("Here:\nconst a = 1;");
  });

  it("leaves ordinary punctuation and escaped markers alone", () => {
    expect(
      markdownToPlainText("snake_case_name, 2 * 3 * 4, a*b*c, x < y > z, 5 - 3, \\*literal\\*"),
    ).toBe("snake_case_name, 2 * 3 * 4, a*b*c, x < y > z, 5 - 3, *literal*");
  });
});
