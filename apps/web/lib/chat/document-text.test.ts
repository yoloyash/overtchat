import { beforeAll, describe, expect, it } from "vitest";
import { countTextTokens } from "./context-budget";
import {
  findPhrase,
  findTerms,
  measureTokens,
  normalizeOffset,
  queryTerms,
  rangeEnd,
  snippetAround,
} from "./document-text";

const paragraph =
  "The quarterly revenue grew by twelve percent, driven by enterprise demand.\n";

describe("document token ranges", () => {
  beforeAll(() => {
    // Building the real tokenizer's vocabulary can exceed a test's 5s budget
    // on a busy runner. Pay that one-time cost in setup instead.
    countTextTokens("Initialize the chat tokenizer.");
  }, 30_000);

  it("measures whole documents and stops counting past the limit", () => {
    const text = paragraph.repeat(200);
    const exact = measureTokens(text, Number.MAX_SAFE_INTEGER, "measure-a");
    expect(Math.abs(exact - countTextTokens(text))).toBeLessThan(20);
    expect(measureTokens(text, 100, "measure-b")).toBeGreaterThan(100);
    expect(measureTokens(text, 100, "measure-b")).toBeLessThan(exact);
    // Cached and uncached measurement agree.
    expect(measureTokens(text, Number.MAX_SAFE_INTEGER)).toBe(exact);
    expect(measureTokens(text, Number.MAX_SAFE_INTEGER, "measure-a")).toBe(exact);
  });

  it("returns the end of text that fits entirely", () => {
    const text = paragraph.repeat(3);
    expect(rangeEnd(text, 0, 10_000, "fits")).toBe(text.length);
    expect(rangeEnd(text, 10, 10_000)).toBe(text.length);
    expect(rangeEnd(text, text.length, 10_000)).toBe(text.length);
  });

  it("cuts within the budget at a line break near the end", () => {
    const text = paragraph.repeat(400);
    const end = rangeEnd(text, 0, 1_000, "lines");
    expect(end).toBeLessThan(text.length);
    expect(text[end - 1]).toBe("\n");
    expect(countTextTokens(text.slice(0, end))).toBeLessThanOrEqual(1_010);
    expect(countTextTokens(text.slice(0, end))).toBeGreaterThan(900);
  });

  it("continues from an offset without overlap or gaps", () => {
    const text = paragraph.repeat(400);
    let offset = 0;
    const chunks: string[] = [];
    while (offset < text.length) {
      const end = rangeEnd(text, offset, 2_000);
      expect(end).toBeGreaterThan(offset);
      chunks.push(text.slice(offset, end));
      offset = end;
    }
    expect(chunks.join("")).toBe(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("falls back to a word break, then a hard cut, in unbroken text", () => {
    const words = "alpha beta gamma delta ".repeat(2_000);
    const wordEnd = rangeEnd(words, 0, 500);
    expect(words[wordEnd - 1]).toBe(" ");
    const solid = "x".repeat(50_000);
    const solidEnd = rangeEnd(solid, 0, 500);
    expect(solidEnd).toBeGreaterThan(0);
    // Count in pieces as production does: tokenizing one long unbroken run
    // at once is quadratic.
    expect(measureTokens(solid.slice(0, solidEnd), Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(500);
  });

  it("counts CJK text by tokens rather than characters", () => {
    const cjk = "季度收入比上一期增长了百分之十二，主要得益于企业客户的强劲需求。".repeat(150);
    const end = rangeEnd(cjk, 0, 600, "cjk");
    expect(end).toBeLessThan(cjk.length);
    expect(countTextTokens(cjk.slice(0, end))).toBeLessThanOrEqual(600);
    expect(countTextTokens(cjk.slice(0, end))).toBeGreaterThan(500);
    // Far fewer characters than a four-characters-per-token estimate.
    expect(end).toBeLessThan(600 * 2);
  });

  it("never splits a surrogate pair", () => {
    const emoji = "😀".repeat(5_000);
    for (const budget of [7, 50, 333]) {
      const end = rangeEnd(emoji, 0, budget);
      expect(end % 2).toBe(0);
      expect(emoji.slice(0, end)).not.toMatch(/[\uD800-\uDBFF]$/u);
    }
    expect(normalizeOffset(emoji, 3)).toBe(2);
    expect(normalizeOffset(emoji, -4)).toBe(0);
    expect(normalizeOffset(emoji, 1e9)).toBe(emoji.length);
    expect(normalizeOffset(emoji, 4.7)).toBe(4);
  });
});

describe("document search", () => {
  const text = [
    "Introduction to the annual report.",
    "Revenue grew strongly in the third quarter.",
    "Operating costs fell.\nNet  REVENUE\nwas a record.",
    "The İstanbul office opened. Revenue in Istanbul doubled.",
  ].join("\n");

  it("finds whole phrases case-insensitively across whitespace", () => {
    const matches = findPhrase(text, "net revenue");
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0].start, matches[0].end)).toBe("Net  REVENUE");
    expect(findPhrase(text, "revenue").map((m) => text.slice(m.start, m.end))).toEqual([
      "Revenue",
      "REVENUE",
      "Revenue",
    ]);
    expect(findPhrase(text, "   ")).toEqual([]);
  });

  it("treats regular expression characters literally", () => {
    const source = "Total (USD): $1.5M [audited] a+b=c";
    expect(findPhrase(source, "(USD): $1.5M")).toHaveLength(1);
    expect(findPhrase(source, "[audited]")).toHaveLength(1);
    expect(findPhrase(source, "a+b")).toHaveLength(1);
    expect(findPhrase(source, "1x5M")).toHaveLength(0);
  });

  it("keeps offsets aligned for characters whose case mapping changes length", () => {
    const matches = findPhrase(text, "istanbul");
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      expect(text.slice(match.start, match.end).toLowerCase()).toContain("stanbul");
    }
  });

  it("finds passages with most query words when the phrase is absent", () => {
    const body = [
      "Revenue figures appear in many places.",
      "x ".repeat(400),
      "In the third quarter, revenue and margin both improved.",
      "y ".repeat(400),
      "Margin commentary only.",
    ].join("\n");
    const matches = findTerms(body, "third quarter revenue margin outlook");
    expect(matches.length).toBeGreaterThan(0);
    expect(body.slice(matches[0].start, matches[0].end + 60)).toContain("third quarter");
    expect(matches[0].score).toBeGreaterThanOrEqual(4);
  });

  it("does not use term matching for single-word queries", () => {
    expect(queryTerms("Revenue, revenue!")).toEqual(["revenue"]);
    expect(findTerms(text, "revenue")).toEqual([]);
  });

  it("builds single-line snippets that start on a word boundary", () => {
    const body = `${"lorem ipsum ".repeat(30)}the needle sits here\nand continues ${"dolor sit ".repeat(30)}`;
    const [match] = findPhrase(body, "needle");
    const { offset, snippet } = snippetAround(body, match, 40);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("the needle sits here and continues");
    expect(snippet).not.toContain("\n");
    expect(body.slice(offset)).toMatch(/^\S/u);
    expect(offset).toBeLessThanOrEqual(match.start);
  });

  it("does not add ellipses at the document edges", () => {
    const body = "needle at the start and the end";
    const [match] = findPhrase(body, "needle");
    expect(snippetAround(body, match)).toEqual({ offset: 0, snippet: body });
  });
});
