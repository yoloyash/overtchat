import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  readMessageStats,
  readStoredMessageStats,
  writeStoredMessageStats,
} from "./stats";

function messageWithStats(stats: unknown): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [],
    metadata: { stats },
  } as UIMessage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("message stats", () => {
  it("reads provider cache token details from message metadata", () => {
    expect(
      readMessageStats(
        messageWithStats({
          contextTokens: 1200,
          cacheReadTokens: 900,
          cacheWriteTokens: 25,
          uncachedInputTokens: 275,
          responseTokens: 80,
        }),
      ),
    ).toEqual({
      contextTokens: 1200,
      cacheReadTokens: 900,
      cacheWriteTokens: 25,
      uncachedInputTokens: 275,
      responseTokens: 80,
      totalTokens: undefined,
      ttftMs: undefined,
      tps: undefined,
      finishReason: undefined,
      providerLabel: undefined,
      providerIconId: undefined,
      model: undefined,
      modelIconId: undefined,
    });
  });

  it("round-trips optional cache fields through local storage", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });

    writeStoredMessageStats({
      "assistant-1": {
        cacheReadTokens: 640,
        cacheWriteTokens: 32,
        uncachedInputTokens: 128,
      },
    });

    expect(readStoredMessageStats()).toEqual({
      "assistant-1": {
        contextTokens: undefined,
        cacheReadTokens: 640,
        cacheWriteTokens: 32,
        uncachedInputTokens: 128,
        responseTokens: undefined,
        totalTokens: undefined,
        ttftMs: undefined,
        tps: undefined,
        finishReason: undefined,
        providerLabel: undefined,
        providerIconId: undefined,
        model: undefined,
        modelIconId: undefined,
      },
    });
  });

  it("ignores malformed cache fields while retaining valid legacy stats", () => {
    expect(
      readMessageStats(
        messageWithStats({
          contextTokens: 42,
          cacheReadTokens: "40",
          cacheWriteTokens: Number.POSITIVE_INFINITY,
          uncachedInputTokens: null,
        }),
      ),
    ).toMatchObject({
      contextTokens: 42,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
      uncachedInputTokens: undefined,
    });
  });
});
