import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { inputReferences } from "./inputs";

describe("code execution input references", () => {
  it("collects authenticated chat uploads and prior generated outputs", () => {
    const messages = [
      {
        id: "user",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "data.csv",
            mediaType: "text/csv",
            url: "/api/uploads/input",
          },
        ],
      },
      {
        id: "assistant",
        role: "assistant",
        parts: [
          {
            type: "tool-execute_code",
            toolCallId: "call",
            state: "output-available",
            input: { language: "python", code: "pass" },
            output: {
              stdout: null,
              stderr: null,
              result: null,
              outputs: [
                {
                  kind: "file",
                  name: "result.csv",
                  mediaType: "text/csv",
                  byteLength: 4,
                  url: "/api/uploads/output",
                },
              ],
            },
          },
        ],
      },
    ] satisfies UIMessage[];

    expect(inputReferences(messages)).toEqual([
      { name: "data.csv", url: "/api/uploads/input" },
      { name: "result.csv", url: "/api/uploads/output" },
    ]);
  });

  it("rejects external and browser-local URLs and disambiguates names", () => {
    const messages = [
      {
        id: "user",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "data.csv",
            mediaType: "text/csv",
            url: "/api/uploads/one",
          },
          {
            type: "file",
            filename: "data.csv",
            mediaType: "text/csv",
            url: "/api/uploads/two",
          },
          {
            type: "file",
            filename: "bad.csv",
            mediaType: "text/csv",
            url: "https://example.com/bad.csv",
          },
          {
            type: "file",
            filename: "local.csv",
            mediaType: "text/csv",
            url: "blob:test",
          },
        ],
      },
    ] satisfies UIMessage[];

    expect(inputReferences(messages)).toEqual([
      { name: "data.csv", url: "/api/uploads/one" },
      { name: "data-2.csv", url: "/api/uploads/two" },
    ]);
  });
});
