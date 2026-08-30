"use client";

import {
  OpenAIRealtimeWebSocket,
  RealtimeAgent,
  RealtimeSession,
  tool,
  type TransportEvent,
} from "@openai/agents/realtime";
import type {
  VoiceSessionGrant,
  VoiceToolDefinition,
} from "@overtchat/shared";

export type VoiceClientStatus =
  | "connecting"
  | "listening"
  | "user-speaking"
  | "thinking"
  | "assistant-speaking"
  | "closed";

export interface VoiceTranscriptUpdate {
  id: string;
  role: "user" | "assistant";
  text: string;
  partial: boolean;
}

export interface VoiceClientCallbacks {
  onStatus: (status: VoiceClientStatus) => void;
  onTranscript: (update: VoiceTranscriptUpdate) => void;
  onInputLevel: (level: number) => void;
  onError: (error: Error) => void;
  onRecoverableError: (error: Error) => void;
  onToolActivity: (label: string | null) => void;
}

const AUDIO_SAMPLE_RATE = 24_000;
const MIC_CHUNK_MS = 40;

function websocketUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

function errorFrom(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (value && typeof value === "object") {
    const candidate = value as { error?: unknown; message?: unknown };
    if (candidate.error instanceof Error) return candidate.error;
    if (typeof candidate.message === "string") return new Error(candidate.message);
  }
  return new Error(fallback);
}

async function executeVoiceTool(name: string, input: unknown): Promise<string> {
  try {
    const response = await fetch("/api/voice/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, input }),
    });
    const body = (await response.json().catch(() => null)) as
      | { output?: unknown; error?: string }
      | null;
    if (!response.ok) {
      return JSON.stringify({
        error: body?.error || `Tool failed (${response.status})`,
      });
    }
    return JSON.stringify(body?.output ?? null);
  } catch {
    return JSON.stringify({ error: "The tool could not be reached." });
  }
}

function realtimeTools(
  definitions: VoiceToolDefinition[],
  callbacks: VoiceClientCallbacks,
) {
  return definitions.map((definition) =>
    tool({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters as never,
      strict: false,
      execute: async (input) => {
        callbacks.onToolActivity(
          definition.name === "web_search" ? "Searching the web" : "Reading a source",
        );
        try {
          return await executeVoiceTool(definition.name, input);
        } finally {
          callbacks.onToolActivity(null);
        }
      },
    }),
  );
}

export class OvertChatVoiceClient {
  private readonly grant: VoiceSessionGrant;
  private readonly callbacks: VoiceClientCallbacks;
  private session: RealtimeSession | null = null;
  private transport: OpenAIRealtimeWebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private playback: AudioWorkletNode | null = null;
  private muted = false;
  private closing = false;
  private currentUserItem = "";
  private userText = new Map<string, string>();
  private assistantText = new Map<string, string>();

  constructor(grant: VoiceSessionGrant, callbacks: VoiceClientCallbacks) {
    this.grant = grant;
    this.callbacks = callbacks;
  }

  async connect(): Promise<void> {
    this.callbacks.onStatus("connecting");
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (this.closing) {
      await this.close();
      return;
    }
    await this.setupAudio();
    if (this.closing) {
      await this.close();
      return;
    }

    this.transport = new OpenAIRealtimeWebSocket({ useInsecureApiKey: true });
    const agent = new RealtimeAgent({
      name: "OvertChat",
      instructions:
        "Have a natural spoken conversation. Listen carefully, answer directly, and use available tools when they would improve the answer.",
      voice: "af_heart",
      tools: realtimeTools(this.grant.tools, this.callbacks),
    });
    this.session = new RealtimeSession(agent, {
      transport: this.transport,
      model: this.grant.model,
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
      }
    });
    this.session.on("audio", (event) => this.onAudio(event.data));
    this.session.on("audio_interrupted", () => this.clearPlayback());
    this.session.on("error", (event) => {
      this.callbacks.onRecoverableError(
        errorFrom(event.error, "A voice action failed."),
      );
    });

    await this.session.connect({
      apiKey: this.grant.token,
      model: this.grant.model,
      url: websocketUrl(this.grant.endpoint),
    });
    if (this.closing) {
      await this.close();
      return;
    }
    this.callbacks.onStatus("listening");
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.capture?.port.postMessage({ kind: "enable", value: !muted });
    for (const track of this.mediaStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  interrupt(): void {
    this.clearPlayback();
    this.session?.interrupt();
    this.callbacks.onStatus("listening");
  }

  async close(): Promise<void> {
    this.closing = true;
    this.session?.close();
    this.session = null;
    this.transport = null;
    this.clearPlayback();
    for (const node of [this.capture, this.playback, this.source]) {
      try {
        node?.disconnect();
      } catch {}
    }
    this.capture = null;
    this.playback = null;
    this.source = null;
    for (const track of this.mediaStream?.getTracks() ?? []) track.stop();
    this.mediaStream = null;
    await this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.callbacks.onInputLevel(0);
    this.callbacks.onStatus("closed");
  }

  private async setupAudio(): Promise<void> {
    const context = new AudioContext({ latencyHint: "interactive" });
    this.audioContext = context;
    if (context.state === "suspended") await context.resume();
    await Promise.all([
      context.audioWorklet.addModule("/voice/mic-capture.js"),
      context.audioWorklet.addModule("/voice/audio-playback.js"),
    ]);
    this.source = context.createMediaStreamSource(this.mediaStream!);
    this.capture = new AudioWorkletNode(context, "overtchat-mic-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { chunkMs: MIC_CHUNK_MS },
    });
    this.capture.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) {
        if (!this.muted) this.session?.sendAudio(event.data);
      } else if (
        event.data &&
        typeof event.data === "object" &&
        "level" in event.data &&
        typeof event.data.level === "number"
      ) {
        this.callbacks.onInputLevel(event.data.level);
      }
    };
    this.source.connect(this.capture);

    this.playback = new AudioWorkletNode(context, "overtchat-audio-playback", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.playback.port.postMessage({ kind: "config", inputRate: AUDIO_SAMPLE_RATE });
    this.playback.connect(context.destination);
  }

  private onAudio(buffer: ArrayBuffer): void {
    if (!this.playback) return;
    const view = new DataView(buffer);
    const samples = new Float32Array(buffer.byteLength / 2);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = view.getInt16(index * 2, true);
      samples[index] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
    }
    this.playback.port.postMessage({ kind: "audio", samples }, [samples.buffer]);
    this.callbacks.onStatus("assistant-speaking");
  }

  private clearPlayback(): void {
    this.playback?.port.postMessage({ kind: "clear" });
  }

  private onTransportEvent(event: TransportEvent): void {
    switch (event.type) {
      case "input_audio_buffer.speech_started": {
        this.clearPlayback();
        this.currentUserItem = typeof event.item_id === "string" ? event.item_id : "";
        this.callbacks.onStatus("user-speaking");
        break;
      }
      case "input_audio_buffer.speech_stopped":
        this.callbacks.onStatus("thinking");
        break;
      case "conversation.item.input_audio_transcription.delta": {
        const id = typeof event.item_id === "string" ? event.item_id : this.currentUserItem;
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (!id || !delta) break;
        const text = `${this.userText.get(id) ?? ""}${delta}`;
        this.userText.set(id, text);
        this.callbacks.onTranscript({ id, role: "user", text, partial: true });
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const id = typeof event.item_id === "string" ? event.item_id : this.currentUserItem;
        const text = typeof event.transcript === "string" ? event.transcript : this.userText.get(id) ?? "";
        if (id && text) {
          this.userText.delete(id);
          this.callbacks.onTranscript({ id, role: "user", text, partial: false });
        }
        break;
      }
      case "response.created":
        this.callbacks.onStatus("thinking");
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const id = typeof event.response_id === "string" ? event.response_id : "assistant";
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (!delta) break;
        const text = `${this.assistantText.get(id) ?? ""}${delta}`;
        this.assistantText.set(id, text);
        this.callbacks.onTranscript({ id, role: "assistant", text, partial: true });
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const id = typeof event.response_id === "string" ? event.response_id : "assistant";
        const text =
          typeof event.transcript === "string"
            ? event.transcript
            : this.assistantText.get(id) ?? "";
        if (text) {
          this.assistantText.delete(id);
          this.callbacks.onTranscript({ id, role: "assistant", text, partial: false });
        }
        break;
      }
      case "response.done":
        this.callbacks.onToolActivity(null);
        this.callbacks.onStatus("listening");
        break;
    }
  }
}
