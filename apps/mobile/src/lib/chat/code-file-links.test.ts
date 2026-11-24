import { describe, expect, it } from "vitest";
import { separateFileLinks } from "./code-file-links";

describe("code file links on mobile", () => {
  it("gives each link on a line of only file links its own paragraph", () => {
    expect(separateFileLinks("[a](a.csv) [b](b%20(2).csv)")).toBe("[a](a.csv)\n\n[b](b%20(2).csv)");
    expect(separateFileLinks("Files:\n[a](sandbox:/mnt/data/a.csv)\n![c](c.png)\nDone.")).toBe(
      "Files:\n\n[a](sandbox:/mnt/data/a.csv)\n\n![c](c.png)\n\nDone.",
    );
  });

  it("keeps the blank lines a reply already has", () => {
    const reply = "Here:\n\n[Totals](totals.csv)\n\nThat is all.";
    expect(separateFileLinks(reply)).toBe(reply);
  });

  it("leaves links in sentences, lists, web links and code alone", () => {
    for (const reply of [
      "See [the table](totals.csv) for details.",
      "- [report](report.docx)",
      "  [report](report.docx)",
      "[Docs](https://example.com/a.csv)",
      "[a](a.csv) [Docs](https://example.com)",
      "```\n[a](a.csv) [b](b.csv)\n```",
      "~~~~md\n[a](a.csv) [b](b.csv)\n```\n[c](c.csv) [d](d.csv)\n~~~~",
    ]) {
      expect(separateFileLinks(reply)).toBe(reply);
    }
  });

  it("separates links again after a code block closes", () => {
    expect(separateFileLinks("```\ncode\n```\n[a](a.csv) [b](b.csv)")).toBe(
      "```\ncode\n```\n\n[a](a.csv)\n\n[b](b.csv)",
    );
  });
});
