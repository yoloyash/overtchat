import { describe, expect, it } from "vitest";
import {
  codexDefaultThinkingLevel,
  codexSessionMetadata,
  codexThinkingLevels,
  parseCodexModels,
  parseCodexThread,
} from "./protocol";

describe("Codex protocol parsing", () => {
  it("maps the model catalog without inventing context limits", () => {
    const response = {
      data: [
        {
          id: "gpt-5.6",
          model: "gpt-5.6",
          displayName: "GPT-5.6",
          inputModalities: ["text", "image"],
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "" },
            { reasoningEffort: "high", description: "" },
          ],
          defaultReasoningEffort: "high",
        },
      ],
    };

    expect(parseCodexModels(response)).toEqual([
      expect.objectContaining({
        id: "gpt-5.6",
        name: "GPT-5.6",
        provider: "codex",
        input: ["text", "image"],
        contextWindow: null,
        maxTokens: null,
      }),
    ]);
    expect(codexThinkingLevels(response, "gpt-5.6")).toEqual([
      "low",
      "high",
    ]);
    expect(codexDefaultThinkingLevel(response, "gpt-5.6")).toBe("high");
  });

  it("maps native threads to existing session metadata", () => {
    const thread = parseCodexThread({
      id: "thread-1",
      cwd: "/workspace",
      preview: "Fix the test",
      name: "Test repair",
      path: "/home/user/.codex/sessions/thread.jsonl",
      createdAt: 100,
      updatedAt: 200,
      turns: [
        {
          id: "turn-1",
          status: "completed",
          startedAt: 100,
          items: [{ id: "user-1", type: "userMessage" }],
        },
      ],
    });

    expect(codexSessionMetadata(thread)).toEqual({
      providerSessionId: "thread-1",
      providerSessionPath: "/home/user/.codex/sessions/thread.jsonl",
      name: "Test repair",
      firstMessage: "Fix the test",
      messageCount: 1,
      createdAt: new Date(100_000),
      modifiedAt: new Date(200_000),
    });
  });
});
