import { describe, expect, it } from "vitest";
import {
  buildRuntimeContext,
  normalizeTimeZone,
  prependRuntimeContext,
  renderRuntimeContext,
} from "./runtime-context";

describe("runtime context", () => {
  it("formats a server timestamp in the client's validated timezone", () => {
    const context = buildRuntimeContext({
      turn: 4,
      webSearchMode: "required",
      timeZone: "America/Los_Angeles",
      now: new Date("2026-07-19T23:42:18.000Z"),
    });

    expect(context).toMatchObject({
      currentTurn: 4,
      currentDateTime: "Sunday, July 19, 2026 at 4:42:18 PM PDT",
      timeZone: "America/Los_Angeles",
      webSearchMode: "required",
      webSearchAttempted: false,
    });
    expect(renderRuntimeContext(context)).toContain(
      "Web search: required for this turn; call web_search before answering.",
    );
  });

  it("falls back to UTC for absent or invalid timezone hints", () => {
    expect(normalizeTimeZone()).toBe("UTC");
    expect(normalizeTimeZone("definitely/not-a-zone")).toBe("UTC");
  });

  it("prepends the block only to the final user message without mutation", () => {
    const messages = [
      { role: "user" as const, content: "Earlier question" },
      { role: "assistant" as const, content: "Earlier answer" },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Current question" },
          {
            type: "file" as const,
            data: "data:text/plain;base64,SGVsbG8=",
            mediaType: "text/plain",
          },
        ],
      },
    ];

    const result = prependRuntimeContext(messages, "<runtime_context />");

    expect(result).not.toBe(messages);
    expect(result[0]).not.toBe(messages[0]);
    expect(result[0]).toMatchObject({
      role: "user",
      content: [
        {
          type: "text",
          text: "Earlier question",
          providerOptions: {
            openai: { promptCacheBreakpoint: { type: "ephemeral" } },
          },
        },
      ],
    });
    expect(result[1]).not.toBe(messages[1]);
    expect(result[1]).toMatchObject({
      role: "assistant",
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    });
    expect(result[2]).not.toBe(messages[2]);
    expect(result[2]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "<runtime_context />" },
        { type: "text", text: "Current question" },
        { type: "file", mediaType: "text/plain" },
      ],
    });
    expect(messages[2].content).toHaveLength(2);
    expect(messages[2].content[0]).toEqual({
      type: "text",
      text: "Current question",
    });
  });

  it("converts string content into ordered text parts", () => {
    const result = prependRuntimeContext(
      [{ role: "user", content: "Hello" }],
      "runtime",
    );

    expect(result).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "runtime" },
          { type: "text", text: "Hello" },
        ],
      },
    ]);
  });
});
