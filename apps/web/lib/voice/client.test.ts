import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceClientCallbacks } from "./client";
import { OvertChatVoiceClient } from "./client";

const callbacks: VoiceClientCallbacks = {
  onStatus: vi.fn(),
  onTranscript: vi.fn(),
  onInputLevel: vi.fn(),
  onOutputLevel: vi.fn(),
  onError: vi.fn(),
  onToolActivity: vi.fn(),
  onHistoryItems: vi.fn(),
};

function client() {
  return new OvertChatVoiceClient(
    {
      token: "ticket",
      chatId: "chat",
      endpoint: "/api/voice/realtime",
      voice: "af_heart",
      tools: [],
    },
    callbacks,
  ) as unknown as {
    onTransportEvent: (event: Record<string, unknown>) => void;
  };
}

describe("realtime transcript history", () => {
  beforeEach(() => vi.clearAllMocks());

  it("promotes a final user transcript into persistent history", () => {
    client().onTransportEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "user-item",
      transcript: "Hello there",
    });

    expect(callbacks.onTranscript).toHaveBeenCalledWith({
      id: "user-item",
      role: "user",
      text: "Hello there",
      partial: false,
    });
    expect(callbacks.onHistoryItems).toHaveBeenCalledWith([
      {
        type: "message",
        id: "user-item",
        previousId: null,
        role: "user",
        status: "completed",
        text: "Hello there",
      },
    ]);
  });

  it("promotes a final assistant transcript into persistent history", () => {
    client().onTransportEvent({
      type: "response.output_audio_transcript.done",
      item_id: "assistant-item",
      response_id: "response",
      transcript: "Hi back",
    });

    expect(callbacks.onHistoryItems).toHaveBeenCalledWith([
      {
        type: "message",
        id: "assistant-item",
        previousId: null,
        role: "assistant",
        status: "completed",
        text: "Hi back",
      },
    ]);
  });
});
