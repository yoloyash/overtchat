import { OpenAIRealtimeWebSocket } from "@openai/agents/realtime";

/** Keep the SDK's protocol/connection handling; the worklet owns played time. */
export class VoicePlaybackTransport extends OpenAIRealtimeWebSocket {
  constructor(
    private readonly stopPlayback: () => void,
    options: ConstructorParameters<typeof OpenAIRealtimeWebSocket>[0] = {},
  ) {
    super(options);
  }

  override interrupt(cancelOngoingResponse = true): void {
    if (this.status !== "connected") return;
    if (cancelOngoingResponse) this._cancelResponse();
    // The stock implementation uses time since the first received chunk and
    // forgets the item at audio.done. Neither describes buffered playback.
    this.stopPlayback();
    this.emit("audio_interrupted");
  }
}

export interface VoiceAudioItem {
  itemId: string;
  contentIndex: number;
  responseId: string;
}

export type PlaybackEvent =
  | { kind: "drained"; item: VoiceAudioItem }
  | {
      kind: "interrupted";
      items: (VoiceAudioItem & { playedSamples: number })[];
    };

export function audioItemKey(item: VoiceAudioItem): string {
  return `${item.itemId}:${item.contentIndex}`;
}
