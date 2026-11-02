import {
  OpenAIRealtimeWebSocket,
  RealtimeAgent,
  RealtimeSession,
  type TransportEvent,
} from "@openai/agents-realtime";
import type { VoiceSessionGrant } from "@overtchat/shared";

export type VoiceClientStatus =
  | "connecting"
  | "listening"
  | "user-speaking"
  | "thinking"
  | "assistant-speaking"
  | "closed";

export interface VoiceClientCallbacks {
  onStatus: (status: VoiceClientStatus) => void;
  onInputLevel: (level: number) => void;
  onOutputLevel: (level: number) => void;
  onError: (error: Error) => void;
  onWarning?: (message: string | null) => void;
}

export const AUDIO_SAMPLE_RATE = 24_000;

export interface VoiceAudio {
  start(onAudio: (data: ArrayBuffer) => void): Promise<void>;
  setMuted(muted: boolean): void;
  play(data: ArrayBuffer): void;
  clear(): void;
  close(): Promise<void>;
}

export interface VoiceClientPlatform {
  audio: VoiceAudio;
  websocketUrl: (path: string) => string;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  createWebSocket?: (options: { url: string; apiKey: string }) => Promise<WebSocket>;
}

export class OvertChatVoiceClient {
  private readonly grant: VoiceSessionGrant;
  private readonly callbacks: VoiceClientCallbacks;
  private session: RealtimeSession | null = null;
  private transport: OpenAIRealtimeWebSocket | null = null;
  private muted = false;
  private closing = false;
  private activeTurnId: string | null = null;
  private responseId: string | null = null;
  private playableResponseId: string | null = null;
  private suppressPlayback = false;
  private switchingTurns = false;
  private submissions: Promise<void> = Promise.resolve();
  private readonly changes = new Set<() => void>();

  constructor(grant: VoiceSessionGrant, callbacks: VoiceClientCallbacks, private readonly platform: VoiceClientPlatform) {
    this.grant = grant;
    this.callbacks = callbacks;
  }

  async connect(): Promise<void> {
    this.callbacks.onStatus("connecting");
    await this.platform.audio.start((data) => {
      if (!this.muted && !this.closing) this.session?.sendAudio(data);
    });
    if (this.closing) {
      await this.platform.audio.close();
      return;
    }

    // The SDK's declarations resolve its Node shim, but its transport uses the
    // standard WebSocket interface supplied by browsers and React Native.
    type SocketFactory = NonNullable<ConstructorParameters<typeof OpenAIRealtimeWebSocket>[0]>["createWebSocket"];
    this.transport = new OpenAIRealtimeWebSocket({ useInsecureApiKey: true,
      createWebSocket: this.platform.createWebSocket as unknown as SocketFactory });
    const agent = new RealtimeAgent({
      name: "OvertChat",
      voice: this.grant.voice,
      // Tools execute once in the shared server generation, never in the browser.
      tools: [],
    });
    this.session = new RealtimeSession(agent, {
      transport: this.transport,
      model: this.grant.token,
      tracingDisabled: true,
      config: {
        outputModalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcm", rate: AUDIO_SAMPLE_RATE },
            transcription: { model: "parakeet-tdt-0.6b-v3" },
            turnDetection: { type: "server_vad", interruptResponse: true },
            noiseReduction: null,
          },
          output: {
            format: { type: "audio/pcm", rate: AUDIO_SAMPLE_RATE },
            speed: 1,
          },
        },
      },
    });
    this.transport.on("*", (event) => this.onTransportEvent(event));
    this.transport.on("connection_change", (status) => {
      if (status === "disconnected" && !this.closing) {
        this.callbacks.onError(new Error("The voice connection closed unexpectedly."));
        void this.close();
      }
    });
    this.session.on("audio", (event) => this.onAudio(event.data, event.responseId));
    this.session.on("audio_interrupted", () => this.clearPlayback());
    this.session.on("error", () => {
      // Provider error payloads can contain request bodies or credentials.
      this.callbacks.onWarning?.("The voice response failed. Please try speaking again.");
    });

    await this.session.connect({
      apiKey: this.grant.token,
      model: this.grant.token,
      url: this.platform.websocketUrl(this.grant.endpoint),
    });
    if (this.closing) {
      await this.close();
      return;
    }
    this.callbacks.onStatus("listening");
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.platform.audio.setMuted(muted);
  }

  interrupt(): void {
    this.suppressPlayback = true;
    this.clearPlayback();
    // The SDK's interrupt() is a no-op until it has received audio. Explicit
    // cancellation also stops thinking/TTS, without truncating canonical text.
    this.transport?.sendEvent({ type: "response.cancel" });
    void this.cancelGeneration();
    this.callbacks.onStatus("listening");
  }

  sendMessage(text: string): Promise<void> {
    const value = text.trim();
    if (!value || !this.session || this.closing) return Promise.reject(new Error("Voice is not connected."));
    this.switchingTurns = true;
    this.suppressPlayback = true;
    this.clearPlayback();
    this.callbacks.onWarning?.(null);
    // Serialize rapid sends: each new turn must be accepted before another
    // submission can interrupt it. Never enqueue a response behind old speech.
    const submission = this.submissions.then(async () => {
      if (this.closing || !this.session) throw new Error("Voice has ended.");
      const responseId = this.responseId;
      const previousTurnId = this.activeTurnId;
      this.switchingTurns = true;
      this.suppressPlayback = true;
      this.clearPlayback();
      this.transport?.sendEvent({ type: "response.cancel" });
      await Promise.all([
        this.cancelGeneration(true),
        this.waitFor(() => !responseId || this.responseId !== responseId),
      ]);
      if (this.closing || !this.session) throw new Error("Voice has ended.");
      this.playableResponseId = null;
      this.switchingTurns = false;
      this.suppressPlayback = false;
      this.callbacks.onStatus("thinking");
      this.session.sendMessage(value);
      // Keep the submitted text visible until the canonical user event arrives.
      await this.waitFor(() => this.activeTurnId !== null && this.activeTurnId !== previousTurnId);
    });
    this.submissions = submission.catch(() => { this.switchingTurns = false; });
    return submission;
  }

  private waitFor(ready: () => boolean): Promise<void> {
    if (this.closing) return Promise.reject(new Error("Voice has ended."));
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.changes.delete(check);
        if (error) reject(error); else resolve();
      };
      const check = () => {
        if (this.closing) finish(new Error("Voice has ended."));
        else if (ready()) finish();
      };
      const timer = setTimeout(() => finish(new Error("Voice did not finish switching turns.")), 15_000);
      this.changes.add(check);
    });
  }

  private notifyChange(): void {
    for (const changed of this.changes) changed();
  }

  async close(): Promise<void> {
    this.closing = true;
    this.notifyChange();
    this.session?.close();
    this.session = null;
    this.transport = null;
    this.clearPlayback();
    await this.platform.audio.close();
    this.callbacks.onInputLevel(0);
    this.callbacks.onOutputLevel(0);
    this.callbacks.onStatus("closed");
  }

  setActiveTurn(id: string | null): void {
    this.activeTurnId = id;
    this.notifyChange();
  }

  private async cancelGeneration(waitForCompletion = false): Promise<void> {
    if (!this.activeTurnId) return;
    const clientRequestId = this.activeTurnId;
    const response = await this.platform.fetch("/api/voice/interrupt", {
      method: "POST", headers: { "X-OvertChat-Voice-Ticket": this.grant.token, "Content-Type": "application/json" },
      body: JSON.stringify({ clientRequestId, waitForCompletion }),
    }).catch(() => undefined);
    if (waitForCompletion && !response?.ok) throw new Error("Could not stop the previous response.");
  }

  private onAudio(buffer: ArrayBuffer, responseId: string): void {
    if (this.closing || this.suppressPlayback || responseId !== this.playableResponseId) return;
    this.platform.audio.play(buffer);
    this.callbacks.onStatus("assistant-speaking");
  }

  private clearPlayback(): void {
    this.platform.audio.clear();
  }

  private onTransportEvent(event: TransportEvent): void {
    switch (event.type) {
      case "input_audio_buffer.speech_started": {
        this.callbacks.onWarning?.(null);
        this.suppressPlayback = true;
        this.clearPlayback();
        void this.cancelGeneration();
        this.callbacks.onStatus("user-speaking");
        break;
      }
      case "input_audio_buffer.speech_stopped":
        this.callbacks.onStatus("thinking");
        break;
      case "conversation.item.input_audio_transcription.failed":
        this.callbacks.onWarning?.("Your speech could not be transcribed. Please try speaking again.");
        this.callbacks.onStatus("listening");
        break;
      case "response.created":
        this.responseId = event.response.id;
        this.playableResponseId = event.response.id;
        this.suppressPlayback = this.switchingTurns;
        this.notifyChange();
        this.callbacks.onStatus("thinking");
        break;
      case "response.done":
        if (event.response.id !== this.responseId) break;
        this.responseId = null;
        this.notifyChange();
        if (event.response?.status === "failed") {
          this.callbacks.onWarning?.("The voice response failed. Please try speaking again.");
        }
        this.callbacks.onStatus("listening");
        break;
    }
  }

}
