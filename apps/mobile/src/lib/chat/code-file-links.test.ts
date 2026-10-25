import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { codeFileLinksPlugin } from "./code-file-links";

const md = MarkdownIt({ linkify: true, breaks: true }).use(codeFileLinksPlugin);

/** Inline token types per paragraph, with image sources. */
function inline(markdown: string) {
  return md
    .parse(markdown)
    .filter((token) => token.type === "inline")
    .map((token) =>
      (token.children ?? [])
        .map((child) => (child.type === "image" ? `image:${child.attrGet("src")}:${child.content}` : child.type))
        .join(" "),
    );
}

describe("code file links on mobile", () => {
  it("lays out a line of only file links as blocks", () => {
    expect(inline("[Totals](sandbox:/mnt/data/outputs/totals.csv)")).toEqual([
      "image:sandbox:/mnt/data/outputs/totals.csv:Totals",
    ]);
    expect(inline("[a](a.csv) [b](b%20(2).csv)\n- [report](report.docx)")).toEqual([
      "image:a.csv:a image:b%20(2).csv:b",
      "image:report.docx:report",
    ]);
  });

  it("leaves links in sentences, web links and code alone", () => {
    expect(inline("See [the table](totals.csv) for details.")).toEqual([
      "text link_open text link_close text",
    ]);
    expect(inline("[Docs](https://example.com/a.csv)")).toEqual(["link_open text link_close"]);
    expect(md.parse("```\n[a](a.csv)\n```").map((token) => token.type)).toEqual(["fence"]);
  });
});
