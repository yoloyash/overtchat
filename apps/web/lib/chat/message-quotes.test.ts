import { describe, expect, it } from "vitest";
import {
  formatQuotedMessage,
  normalizeQuoteText,
  splitQuotedMessage,
} from "@overtchat/shared";

describe("normalizeQuoteText", () => {
  it("trims the selection and keeps it verbatim", () => {
    expect(normalizeQuoteText("  kip the pumice stone. \n")).toBe(
      "kip the pumice stone.",
    );
  });

  it("collapses the blank lines a selection across blocks picks up", () => {
    expect(normalizeQuoteText("First.\r\n\r\n\r\n\r\nSecond.  \nThird.")).toBe(
      "First.\n\nSecond.\nThird.",
    );
  });

  it("returns nothing for whitespace", () => {
    expect(normalizeQuoteText(" \n\t ")).toBe("");
  });
});

describe("formatQuotedMessage", () => {
  it("puts each quote ahead of the reply as its own blockquote", () => {
    expect(formatQuotedMessage(["one", "two"], "Why?")).toBe(
      "> one\n\n> two\n\nWhy?",
    );
  });

  it("keeps a quote with a blank line as one blockquote", () => {
    expect(formatQuotedMessage(["a\n\nb"], "ok")).toBe("> a\n>\n> b\n\nok");
  });

  it("leaves a reply without quotes unchanged", () => {
    expect(formatQuotedMessage([], "plain")).toBe("plain");
  });

  it("sends quotes alone when the reply is only attachments", () => {
    expect(formatQuotedMessage(["one"], "")).toBe("> one");
  });
});

describe("splitQuotedMessage", () => {
  it("round-trips a formatted reply", () => {
    const quotes = ["one", "a\n\nb", "> nested"];
    expect(
      splitQuotedMessage(formatQuotedMessage(quotes, "Why?\n\n> later")),
    ).toEqual({ quotes, body: "Why?\n\n> later" });
  });

  it("returns a message of quotes alone with an empty body", () => {
    expect(splitQuotedMessage("> one\n\n> two")).toEqual({
      quotes: ["one", "two"],
      body: "",
    });
  });

  it("leaves messages without a leading blockquote alone", () => {
    expect(splitQuotedMessage("plain\n\n> later")).toEqual({
      quotes: [],
      body: "plain\n\n> later",
    });
    expect(splitQuotedMessage(">5 is the limit")).toEqual({
      quotes: [],
      body: ">5 is the limit",
    });
  });

  it("treats a quote line that runs into prose as prose", () => {
    expect(splitQuotedMessage("> 5 means more\nthan five")).toEqual({
      quotes: [],
      body: "> 5 means more\nthan five",
    });
    expect(splitQuotedMessage("> one\n\n> 5 means more\nthan five")).toEqual({
      quotes: ["one"],
      body: "> 5 means more\nthan five",
    });
  });
});
