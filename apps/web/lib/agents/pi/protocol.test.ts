import { describe, expect, it } from "vitest";
import {
  parsePiCommands,
  parsePiModels,
  parsePiSessionStats,
  parsePiThinkingLevels,
} from "./protocol";

describe("Pi RPC response parsing", () => {
  it("preserves model identity, capabilities, context, and pricing", () => {
    expect(
      parsePiModels({
        models: [
          {
            id: "gpt-5.6",
            name: "GPT-5.6",
            provider: "openai",
            api: "openai-responses",
            baseUrl: "https://api.openai.com/v1",
            reasoning: true,
            input: ["text", "image"],
            contextWindow: 400_000,
            maxTokens: 128_000,
            cost: {
              input: 1.25,
              output: 10,
              cacheRead: 0.125,
              cacheWrite: 0,
              total: 99,
            },
            futureField: true,
          },
        ],
      }),
    ).toEqual([
      {
        id: "gpt-5.6",
        name: "GPT-5.6",
        provider: "openai",
        api: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 400_000,
        maxTokens: 128_000,
        cost: {
          input: 1.25,
          output: 10,
          cacheRead: 0.125,
          cacheWrite: 0,
        },
      },
    ]);
  });

  it("parses Pi's dynamic thinking levels and discovered commands", () => {
    expect(
      parsePiThinkingLevels({ levels: ["off", "medium", "xhigh", "max"] }),
    ).toEqual(["off", "medium", "xhigh", "max"]);
    expect(
      parsePiCommands({
        commands: [
          {
            name: "review",
            description: "Review the current changes",
            source: "prompt",
            sourceInfo: { scope: "project" },
          },
          { name: "deploy", source: "extension" },
        ],
      }),
    ).toEqual([
      {
        name: "review",
        description: "Review the current changes",
        source: "prompt",
      },
      { name: "deploy", source: "extension" },
    ]);
  });

  it("normalizes optional session usage without inventing cost", () => {
    expect(
      parsePiSessionStats({
        sessionFile: "/tmp/session.jsonl",
        sessionId: "native-session",
        userMessages: 2,
        assistantMessages: 2,
        toolCalls: 3,
        toolResults: 3,
        totalMessages: 7,
        tokens: {
          input: 12_000,
          output: 2_000,
          cacheRead: 8_000,
          cacheWrite: 1_000,
          total: 23_000,
        },
        cost: 0.1234,
        contextUsage: {
          tokens: 18_000,
          contextWindow: 200_000,
          percent: 9,
        },
      }),
    ).toEqual({
      sessionFile: "/tmp/session.jsonl",
      sessionId: "native-session",
      userMessages: 2,
      assistantMessages: 2,
      toolCalls: 3,
      toolResults: 3,
      totalMessages: 7,
      tokens: {
        input: 12_000,
        output: 2_000,
        cacheRead: 8_000,
        cacheWrite: 1_000,
        total: 23_000,
      },
      cost: 0.1234,
      contextUsage: {
        tokens: 18_000,
        contextWindow: 200_000,
        percent: 9,
      },
    });

    expect(parsePiSessionStats({})).toMatchObject({
      sessionFile: null,
      sessionId: null,
      cost: 0,
      tokens: { total: 0 },
    });
  });

  it("rejects unknown thinking levels instead of guessing support", () => {
    expect(() =>
      parsePiThinkingLevels({ levels: ["off", "ultra"] }),
    ).toThrow();
  });
});
