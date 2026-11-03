import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { extractSearchText } from "./extract";

describe("continued answer indexing", () => {
  it("keeps a word split across continuation requests searchable as one word", () => {
    expect(extractSearchText([
      { type: "text", text: "An inter" },
      { type: "step-start" },
      { type: "text", text: "rupted answer" },
    ])).toBe("An interrupted answer");
  });
});

describe("document indexing", () => {
  it("indexes each saved document version's title and content", () => {
    expect(
      extractSearchText([
        { type: "text", text: "Here is the plan." },
        {
          type: "tool-create_document",
          toolCallId: "c1",
          state: "output-available",
          input: { title: "Launch plan", type: "markdown", content: "Kickoff in May" },
          output: { id: "launch-plan", title: "Launch plan", type: "markdown", version: 1, content: "Kickoff in May" },
        },
        {
          type: "tool-update_document",
          toolCallId: "c2",
          state: "input-streaming",
          input: { id: "launch-plan" },
        },
      ] as never),
    ).toBe("Here is the plan.\nLaunch plan\nKickoff in May");
  });
});
