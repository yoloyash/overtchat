import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceClientCallbacks } from "./client";
import { OvertChatVoiceClient } from "./client";

const callbacks: VoiceClientCallbacks = {
  onStatus: vi.fn(),
  onInputLevel: vi.fn(),
  onOutputLevel: vi.fn(),
  onError: vi.fn(),
  onWarning: vi.fn(),
};

function client() {
  return new OvertChatVoiceClient(
    {
      token: "ticket",
      sessionId: "session",
      chatId: "chat",
      endpoint: "/api/voice/realtime",
      voice: "af_heart",
    },
    callbacks,
  ) as unknown as {
    onTransportEvent: (event: Record<string, unknown>) => void;
  };
}

describe("voice failures", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recovers from a transcription failure and clears its notice on the next turn", () => {
    const voice = client();
    voice.onTransportEvent({ type: "input_audio_buffer.speech_stopped" });
    voice.onTransportEvent({ type: "conversation.item.input_audio_transcription.failed", item_id: "user" });
    expect(callbacks.onStatus).toHaveBeenLastCalledWith("listening");
    expect(callbacks.onWarning).toHaveBeenLastCalledWith(expect.stringContaining("could not be transcribed"));
    voice.onTransportEvent({ type: "input_audio_buffer.speech_started", item_id: "next" });
    expect(callbacks.onWarning).toHaveBeenLastCalledWith(null);
  });

  it("shows a failed response instead of silently returning to listening", () => {
    const voice = client();
    voice.onTransportEvent({ type: "response.created", response: { id: "response" } });
    voice.onTransportEvent({ type: "response.done", response: { id: "response", status: "failed" } });
    expect(callbacks.onStatus).toHaveBeenLastCalledWith("listening");
    expect(callbacks.onWarning).toHaveBeenLastCalledWith(expect.stringContaining("response failed"));
  });
});
