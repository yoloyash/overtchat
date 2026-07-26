import { describe, expect, it } from "vitest";
import {
  markAnthropicCacheBoundary,
  markAnthropicConversationCacheBoundary,
  markAnthropicSystemCacheBoundary,
  promptCacheKeyForChat,
  withOpenAIPromptCacheKey,
} from "./prompt-cache";

describe("prompt cache boundary", () => {
  it("marks a stable system prefix without changing content", () => {
    const message = { role: "system" as const, content: "Stable prompt" };

    expect(markAnthropicSystemCacheBoundary(message)).toEqual({
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

  it("marks only the latest user without changing prompt content", () => {
    const messages = [
      { role: "user" as const, content: "First question" },
      { role: "assistant" as const, content: "First answer" },
      { role: "user" as const, content: "Follow-up" },
    ];

    const result = markAnthropicConversationCacheBoundary(messages);

    expect(result[0]).toBe(messages[0]);
    expect(result[1]).toBe(messages[1]);
    expect(result[2]).toEqual({
      role: "user",
      content: "Follow-up",
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    });
    expect(messages[2]).toEqual({
      role: "user",
      content: "Follow-up",
    });
  });

  it("marks a first-turn user for reuse on the next turn", () => {
    const messages = [{ role: "user" as const, content: "First question" }];

    expect(markAnthropicConversationCacheBoundary(messages)).toEqual([
      {
        role: "user",
        content: "First question",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
    ]);
    expect(messages).toEqual([
      { role: "user", content: "First question" },
    ]);
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
