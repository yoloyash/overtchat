import { describe, expect, it } from "vitest";
import { filterFileMentions, parseFileMention } from "./file-mentions";

describe("parseFileMention", () => {
  it("reads the # word ending at the caret", () => {
    expect(parseFileMention("#", 1)).toEqual({ query: "", start: 0, end: 1 });
    expect(parseFileMention("summarize #hand", 15)).toEqual({ query: "hand", start: 10, end: 15 });
    expect(parseFileMention("see #spec.pdf now", 13)).toEqual({ query: "spec.pdf", start: 4, end: 13 });
    expect(parseFileMention("line one\n#gu", 12)).toEqual({ query: "gu", start: 9, end: 12 });
  });

  it("ignores a # inside a word, after whitespace, or behind the caret", () => {
    expect(parseFileMention("I like C#", 9)).toBeNull();
    expect(parseFileMention("issue#5", 7)).toBeNull();
    expect(parseFileMention("# Heading", 9)).toBeNull();
    expect(parseFileMention("#hand", 2)).toEqual({ query: "h", start: 0, end: 2 });
    expect(parseFileMention("#hand later", 11)).toBeNull();
  });
});

describe("filterFileMentions", () => {
  const files = [
    { filename: "Launch plan.md" },
    { filename: "handbook.txt" },
    { filename: "Q3 numbers.xlsx" },
  ];

  it("matches substrings without regard to case or spaces, keeping order", () => {
    expect(filterFileMentions(files, "")).toEqual(files);
    expect(filterFileMentions(files, "launchpl").map((f) => f.filename)).toEqual(["Launch plan.md"]);
    expect(filterFileMentions(files, "BOOK").map((f) => f.filename)).toEqual(["handbook.txt"]);
    expect(filterFileMentions(files, "n").map((f) => f.filename)).toEqual([
      "Launch plan.md",
      "handbook.txt",
      "Q3 numbers.xlsx",
    ]);
    expect(filterFileMentions(files, "zzz")).toEqual([]);
  });
});
