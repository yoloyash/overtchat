import { describe, expect, it } from "vitest";
import type { RealtimeItem } from "@openai/agents/realtime";
import { convertToModelMessages, dynamicTool, jsonSchema } from "ai";
import { completedVoiceHistory, voiceHistoryToUiMessages } from "./history";

describe("voice history", () => {
  it("keeps completed transcripts and complete tool calls in realtime order", () => {
    const history = [
      {
        itemId: "user-1",
        type: "message",
        role: "user",
        status: "completed",
        content: [{ type: "input_audio", audio: null, transcript: "Hello" }],
      },
      {
        itemId: "tool-1",
        previousItemId: "user-1",
        type: "function_call",
        status: "completed",
        name: "web_search",
        arguments: '{"query":"today"}',
        output: '{"sources":[{"url":"https://example.com"}]}',
      },
      {
        itemId: "assistant-1",
        previousItemId: "tool-1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_audio", audio: null, transcript: "Here is what happened." }],
      },
      {
        itemId: "partial",
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [{ type: "output_audio", audio: null, transcript: "Ignore" }],
      },
    ] as RealtimeItem[];

    expect(completedVoiceHistory(history)).toEqual([
      {
        type: "message",
        id: "user-1",
        previousId: null,
        role: "user",
        status: "completed",
        text: "Hello",
      },
      {
        type: "tool",
        id: "tool-1",
        previousId: "user-1",
        name: "web_search",
        status: "completed",
        input: { query: "today" },
        output: { sources: [{ url: "https://example.com" }] },
      },
      {
        type: "message",
        id: "assistant-1",
        previousId: "tool-1",
        role: "assistant",
        status: "completed",
        text: "Here is what happened.",
      },
    ]);
  });

  it("uses canonical UI tool parts and stable chat-scoped message ids", () => {
    expect(
      voiceHistoryToUiMessages("chat", [
        {
          type: "tool",
          id: "call",
          previousId: null,
          name: "web_search",
          status: "completed",
          input: { query: "news" },
          output: { error: "Search unavailable" },
        },
      ]),
    ).toEqual([
      {
        id: "voice:chat:call",
        role: "assistant",
        parts: [
          {
            type: "tool-web_search",
            toolCallId: "call",
            input: { query: "news" },
            state: "output-error",
            errorText: "Search unavailable",
          },
        ],
      },
    ]);
  });

  it("restores persisted tool calls and results into model context", async () => {
    const messages = voiceHistoryToUiMessages("chat", [
      {
        type: "message",
        id: "user",
        previousId: null,
        role: "user",
        status: "completed",
        text: "What happened today?",
      },
      {
        type: "tool",
        id: "call",
        previousId: "user",
        name: "web_search",
        status: "completed",
        input: { query: "today" },
        output: { results: [{ title: "News" }] },
      },
      {
        type: "message",
        id: "assistant",
        previousId: "call",
        role: "assistant",
        status: "completed",
        text: "Here is the latest.",
      },
    ]);

    const context = await convertToModelMessages(messages, {
      tools: {
        web_search: dynamicTool({
          inputSchema: jsonSchema({ type: "object" }),
        }),
      },
    });

    expect(context).toEqual([
      { role: "user", content: [{ type: "text", text: "What happened today?" }] },
      {
        role: "assistant",
        content: [
          expect.objectContaining({
            type: "tool-call",
            toolCallId: "call",
            toolName: "web_search",
            input: { query: "today" },
          }),
        ],
      },
      {
        role: "tool",
        content: [
          expect.objectContaining({
            type: "tool-result",
            toolCallId: "call",
            toolName: "web_search",
            output: {
              type: "json",
              value: { results: [{ title: "News" }] },
            },
          }),
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Here is the latest." }] },
    ]);
  });
});
