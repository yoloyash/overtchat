import { describe, expect, it } from "vitest";
import { JsonlDecoder, serializeJsonLine } from "./jsonl";

describe("strict JSONL framing", () => {
  it("splits only on LF and preserves Unicode line separators", () => {
    const decoder = new JsonlDecoder();
    const first = serializeJsonLine({ text: "before\u2028after\u2029done" });
    const second = serializeJsonLine({ text: "two" });
    const bytes = Buffer.from(first + second);

    expect(decoder.push(bytes.subarray(0, 13))).toEqual([]);
    expect(decoder.push(bytes.subarray(13))).toEqual([
      JSON.stringify({ text: "before\u2028after\u2029done" }),
      JSON.stringify({ text: "two" }),
    ]);
    expect(decoder.end()).toEqual([]);
  });

  it("handles split UTF-8 characters and optional CRLF", () => {
    const decoder = new JsonlDecoder();
    const bytes = Buffer.from('{"text":"cafe \u2615"}\r\n');
    const split = bytes.indexOf(Buffer.from("\u2615")) + 1;

    expect(decoder.push(bytes.subarray(0, split))).toEqual([]);
    expect(decoder.push(bytes.subarray(split))).toEqual([
      '{"text":"cafe \u2615"}',
    ]);
  });

  it("emits a final unterminated record", () => {
    const decoder = new JsonlDecoder();
    expect(decoder.push('{"ok":true}')).toEqual([]);
    expect(decoder.end()).toEqual(['{"ok":true}']);
  });
});
