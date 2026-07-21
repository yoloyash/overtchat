import { describe, expect, it } from "vitest";
import {
  markAnthropicCacheBoundary,
  markOpenAICacheBoundary,
  markSystemCacheBoundary,
  promptCacheKeyForChat,
  supportsOpenAIExplicitPromptCaching,
  withOpenAIPromptCacheKey,
} from "./prompt-cache";

describe("prompt cache boundary", () => {
  it("marks a stable system prefix without changing content", () => {
    const message = { role: "system" as const, content: "Stable prompt" };

    expect(markSystemCacheBoundary(message)).toEqual({
      role: "system",
      content: "Stable prompt",
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
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

  it("adds a correctly shaped OpenAI breakpoint only when requested", () => {
    expect(
      markSystemCacheBoundary(
        { role: "system", content: "Stable prompt" },
        { openAIExplicit: true },
      ),
    ).toEqual({
      role: "system",
      content: "Stable prompt",
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
        openai: { promptCacheBreakpoint: { mode: "explicit" } },
      },
    });

    expect(
      markOpenAICacheBoundary({
        role: "user",
        content: "Stable user content",
      }),
    ).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: "Stable user content",
          providerOptions: {
            openai: {
              promptCacheBreakpoint: { mode: "explicit" },
            },
          },
        },
      ],
    });
  });

  it("detects only OpenAI models that accept explicit breakpoints", () => {
    expect(supportsOpenAIExplicitPromptCaching("gpt-5.5-pro")).toBe(false);
    expect(supportsOpenAIExplicitPromptCaching("gpt-5.6-sol")).toBe(true);
    expect(supportsOpenAIExplicitPromptCaching("gpt-6")).toBe(true);
    expect(supportsOpenAIExplicitPromptCaching("openai.gpt-5.6-sol")).toBe(
      true,
    );
    expect(supportsOpenAIExplicitPromptCaching("claude-sonnet-5")).toBe(false);
  });

  it("adds a per-chat OpenAI routing key without overriding admin options", () => {
    expect(
      withOpenAIPromptCacheKey(
        { openai: { reasoningEffort: "high" } },
        "chat:generated",
      ),
    ).toEqual({
      openai: {
        reasoningEffort: "high",
        promptCacheKey: "chat:generated",
      },
    });
    expect(
      withOpenAIPromptCacheKey(
        { openai: { promptCacheKey: "admin-owned" } },
        "chat:generated",
      ),
    ).toEqual({
      openai: { promptCacheKey: "admin-owned" },
    });
    expect(
      withOpenAIPromptCacheKey(
        { openai: { promptCacheKey: null } },
        "chat:generated",
      ),
    ).toEqual({
      openai: { promptCacheKey: null },
    });
  });

  it("hashes client chat IDs into short stable routing keys", () => {
    const key = promptCacheKeyForChat("client-controlled-chat-id");

    expect(key).toMatch(/^chat:[A-Za-z0-9_-]{43}$/);
    expect(promptCacheKeyForChat("client-controlled-chat-id")).toBe(key);
    expect(promptCacheKeyForChat("another-chat-id")).not.toBe(key);
  });
});
