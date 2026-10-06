import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceClientCallbacks } from "./client";
import { OvertChatVoiceClient } from "./client";

const callbacks: VoiceClientCallbacks = {
  onStatus: vi.fn(),
  onTranscript: vi.fn(),
  onInputLevel: vi.fn(),
  onOutputLevel: vi.fn(),
  onError: vi.fn(),
  onWarning: vi.fn(),
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
    onAudio: (buffer: ArrayBuffer) => void;
    onPlaybackEvent: (event: unknown) => void;
    playback: { port: { postMessage: ReturnType<typeof vi.fn> } };
    transport: { status: string; sendEvent: ReturnType<typeof vi.fn> };
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

describe("voice playback and failures", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stays speaking until queued audio drains, after response.done", () => {
    const voice = client();
    voice.playback = { port: { postMessage: vi.fn() } };
    voice.onTransportEvent({ type: "response.created", response: { id: "response" } });
    voice.onTransportEvent({ type: "response.output_audio.delta", item_id: "audio", response_id: "response", content_index: 0 });
    voice.onAudio(new ArrayBuffer(48000));
    voice.onTransportEvent({ type: "response.done", response: { id: "response", status: "completed" } });
    expect(callbacks.onStatus).toHaveBeenLastCalledWith("assistant-speaking");
    voice.onPlaybackEvent({ kind: "drained", item: { itemId: "audio", contentIndex: 0, responseId: "response" } });
    expect(callbacks.onStatus).toHaveBeenLastCalledWith("listening");
  });

  it("sends truncation at the worklet's played position and corrects saved history", () => {
    const voice = client();
    voice.transport = { status: "connected", sendEvent: vi.fn() };
    voice.onPlaybackEvent({ kind: "interrupted", items: [{ itemId: "audio", contentIndex: 0,
      responseId: "response", playedSamples: 2400 }] });
    expect(voice.transport.sendEvent).toHaveBeenCalledWith({ type: "conversation.item.truncate",
      item_id: "audio", content_index: 0, audio_end_ms: 100 });
    voice.onTransportEvent({ type: "conversation.item.truncated", item_id: "audio" });
    expect(callbacks.onHistoryItems).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "audio", text: "[Assistant interrupted]", status: "incomplete" }),
    ]);
  });

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
