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

describe("text interrupts voice", () => {
  function connected() {
    const voice = client() as unknown as {
      sendMessage(text: string): Promise<void>;
      setActiveTurn(id: string | null): void;
      close(): Promise<void>;
      onTransportEvent(event: Record<string, unknown>): void;
      onAudio(data: ArrayBuffer, responseId: string): void;
    };
    const playback = vi.fn();
    const send = vi.fn();
    const transport = vi.fn();
    Object.assign(voice, { session: { sendMessage: send, close: vi.fn() }, transport: { sendEvent: transport },
      playback: { port: { postMessage: playback }, disconnect: vi.fn() } });
    return { voice, playback, send, transport };
  }
  const created = (id: string) => ({ type: "response.created", response: { id } });
  const done = (id: string) => ({ type: "response.done", response: { id, status: "completed" } });
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

  it("clears audio immediately, waits for both cancellations, and drops late old audio", async () => {
    const { voice, playback, send, transport } = connected();
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    voice.onTransportEvent(created("old"));
    voice.setActiveTurn("voice:session:old");
    voice.onAudio(new ArrayBuffer(4), "old");
    const submitted = voice.sendMessage("Change the topic");
    expect(playback).toHaveBeenLastCalledWith({ kind: "clear" });
    await flush();
    expect(transport).toHaveBeenCalledWith({ type: "response.cancel" });
    expect(send).not.toHaveBeenCalled();
    voice.onTransportEvent(done("old"));
    await flush();
    expect(send).not.toHaveBeenCalled();
    voice.setActiveTurn(null);
    finish(new Response(null, { status: 204 }));
    await flush();
    expect(send).toHaveBeenCalledExactlyOnceWith("Change the topic");
    voice.onTransportEvent(created("new"));
    voice.setActiveTurn("voice:session:new");
    await submitted;
    playback.mockClear();
    voice.onAudio(new ArrayBuffer(4), "old");
    expect(playback).not.toHaveBeenCalled();
    voice.onAudio(new ArrayBuffer(4), "new");
    expect(playback).toHaveBeenCalledOnce();
    await voice.close();
    vi.unstubAllGlobals();
  });

  it("interrupts remaining playback even after generation and transport completion", async () => {
    const { voice, playback, send } = connected();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    voice.onTransportEvent(created("completed"));
    voice.onTransportEvent(done("completed"));
    voice.setActiveTurn(null);
    voice.onAudio(new ArrayBuffer(4), "completed");
    const submitted = voice.sendMessage("Next question");
    expect(playback).toHaveBeenLastCalledWith({ kind: "clear" });
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledExactlyOnceWith("Next question");
    voice.onTransportEvent(created("next"));
    voice.setActiveTurn("voice:session:next");
    await submitted;
    await voice.close();
    vi.unstubAllGlobals();
  });

  it("cancels before any audio and serializes two rapid submissions", async () => {
    const { voice, send } = connected();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    voice.onTransportEvent(created("thinking"));
    voice.setActiveTurn("voice:session:thinking");
    const first = voice.sendMessage("First correction");
    const second = voice.sendMessage("Second correction");
    await flush();
    expect(send).not.toHaveBeenCalled();
    voice.onTransportEvent(done("thinking"));
    await flush();
    expect(send).toHaveBeenCalledExactlyOnceWith("First correction");
    voice.onTransportEvent(created("first"));
    voice.setActiveTurn("voice:session:first");
    await first;
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    voice.onTransportEvent(done("first"));
    await flush();
    expect(send).toHaveBeenNthCalledWith(2, "Second correction");
    voice.onTransportEvent(created("second"));
    voice.setActiveTurn("voice:session:second");
    await second;
    await voice.close();
    vi.unstubAllGlobals();
  });

  it("does not submit a replacement if backend cancellation fails", async () => {
    const { voice, send } = connected();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 409 })));
    voice.setActiveTurn("voice:session:old");
    await expect(voice.sendMessage("Replacement")).rejects.toThrow("Could not stop");
    expect(send).not.toHaveBeenCalled();
    await voice.close();
    vi.unstubAllGlobals();
  });

  it("does not send pending text after End", async () => {
    const { voice, send } = connected();
    const submitted = voice.sendMessage("Do not send after closing");
    await voice.close();
    await expect(submitted).rejects.toThrow("ended");
    expect(send).not.toHaveBeenCalled();
  });
});
