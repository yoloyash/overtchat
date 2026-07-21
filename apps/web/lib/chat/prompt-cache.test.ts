import { describe, expect, it } from "vitest";
import {
  markAnthropicCacheBoundary,
  markOpenAICacheBoundary,
  markSystemCacheBoundary,
} from "./prompt-cache";

describe("prompt cache boundary", () => {
  it("marks a stable system prefix without changing content", () => {
    const message = { role: "system" as const, content: "Stable prompt" };

    expect(markSystemCacheBoundary(message)).toEqual({
      role: "system",
      content: "Stable prompt",
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
        openai: { promptCacheBreakpoint: { type: "ephemeral" } },
      },
    });
    expect(message).toEqual({ role: "system", content: "Stable prompt" });
  });

  it("preserves unrelated provider options", () => {
    const result = markAnthropicCacheBoundary({
      role: "assistant",
      content: "Earlier answer",
      providerOptions: {
        custom: { trace: true },
        anthropic: { eagerInputStreaming: true },
      },
    });

    expect(result.providerOptions).toEqual({
      custom: { trace: true },
      anthropic: {
        eagerInputStreaming: true,
        cacheControl: { type: "ephemeral" },
      },
    });
  });

  it("puts OpenAI's breakpoint on the final user content part", () => {
    const result = markOpenAICacheBoundary({
      role: "user",
      content: "Earlier question",
    });

    expect(result).toEqual({
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
  });
});
