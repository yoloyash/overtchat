"use client";

import {
  OpenAIRealtimeWebSocket,
  RealtimeAgent,
  RealtimeSession,
  tool,
  type TransportEvent,
} from "@openai/agents/realtime";
import {
  webSearchResults,
  type PersistedWebSearchOutput,
  type VoiceHistoryItem,
  type VoiceSessionGrant,
  type VoiceToolDefinition,
  type WebSearchResult,
} from "@overtchat/shared";
import { completedVoiceHistory } from "@/lib/voice/history";

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

export interface VoiceToolActivityUpdate {
  id: string;
  label: string;
  detail: string | null;
  status: "running" | "completed" | "failed";
  sources: WebSearchResult[];
}

export interface VoiceClientCallbacks {
  onStatus: (status: VoiceClientStatus) => void;
  onTranscript: (update: VoiceTranscriptUpdate) => void;
  onInputLevel: (level: number) => void;
  onOutputLevel: (level: number) => void;
  onError: (error: Error) => void;
  onToolActivity: (activity: VoiceToolActivityUpdate) => void;
  onHistoryItems?: (items: VoiceHistoryItem[]) => void;
}

const AUDIO_SAMPLE_RATE = 24_000;
const MIC_CHUNK_MS = 40;

function websocketUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

interface VoiceToolResult {
  output: string;
  sources: WebSearchResult[];
  failed: boolean;
}

async function executeVoiceTool(
  name: string,
  input: unknown,
): Promise<VoiceToolResult> {
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
      return {
        output: JSON.stringify({
          error: body?.error || `Tool failed (${response.status})`,
        }),
        sources: [],
        failed: true,
      };
    }
    const output = body?.output ?? null;
    return {
      output: JSON.stringify(output),
      sources:
        name === "web_search"
          ? webSearchResults(output as PersistedWebSearchOutput)
          : [],
      failed: false,
    };
  } catch {
    return {
      output: JSON.stringify({ error: "The tool could not be reached." }),
      sources: [],
      failed: true,
    };
  }
}

function toolDetail(name: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const values = input as { query?: unknown; url?: unknown };
  if (name === "web_search" && typeof values.query === "string") {
    return values.query;
  }
  if (name === "fetch_url" && typeof values.url === "string") {
    try {
      return new URL(values.url).hostname.replace(/^www\./u, "");
    } catch {
      return values.url;
    }
  }
  return null;
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
        const id = crypto.randomUUID();
        const search = definition.name === "web_search";
        const detail = toolDetail(definition.name, input);
        callbacks.onToolActivity({
          id,
          label: search ? "Searching the web" : "Reading a source",
          detail,
          status: "running",
          sources: [],
        });
        const result = await executeVoiceTool(definition.name, input);
        callbacks.onToolActivity({
          id,
          label: result.failed
            ? search
              ? "Search unavailable"
              : "Source unavailable"
            : search
              ? "Searched the web"
              : "Read a source",
          detail,
          status: result.failed ? "failed" : "completed",
          sources: result.sources,
        });
        return result.output;
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
  private outputAnalyser: AnalyserNode | null = null;
  private outputMeterFrame: number | null = null;
  private muted = false;
  private closing = false;
  private currentUserItem = "";
  private userText = new Map<string, string>();
  private assistantText = new Map<string, string>();
  private syncedHistory = new Map<string, string>();

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
      voice: this.grant.voice,
      tools: realtimeTools(this.grant.tools, this.callbacks),
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
      }
    });
    this.session.on("audio", (event) => this.onAudio(event.data));
    this.session.on("audio_interrupted", () => this.clearPlayback());
    this.session.on("history_updated", (history) => {
      const changed = completedVoiceHistory(history).filter((item) => {
        const serialized = JSON.stringify(item);
        if (this.syncedHistory.get(item.id) === serialized) return false;
        this.syncedHistory.set(item.id, serialized);
        return true;
      });
      if (changed.length) this.callbacks.onHistoryItems?.(changed);
    });
    this.session.on("error", (event) => {
      console.warn("Recoverable voice session event", event.error);
    });

    await this.session.connect({
      apiKey: this.grant.token,
      model: this.grant.token,
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

  sendMessage(text: string): void {
    const value = text.trim();
    if (!value || !this.session) return;
    this.session.sendMessage(value);
  }

  async close(): Promise<void> {
    this.closing = true;
    this.session?.close();
    this.session = null;
    this.transport = null;
    this.clearPlayback();
    for (const node of [
      this.capture,
      this.playback,
      this.outputAnalyser,
      this.source,
    ]) {
      try {
        node?.disconnect();
      } catch {}
    }
    this.capture = null;
    this.playback = null;
    this.outputAnalyser = null;
    this.source = null;
    if (this.outputMeterFrame !== null) {
      cancelAnimationFrame(this.outputMeterFrame);
      this.outputMeterFrame = null;
    }
    for (const track of this.mediaStream?.getTracks() ?? []) track.stop();
    this.mediaStream = null;
    await this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.callbacks.onInputLevel(0);
    this.callbacks.onOutputLevel(0);
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
    this.outputAnalyser = context.createAnalyser();
    this.outputAnalyser.fftSize = 256;
    this.outputAnalyser.smoothingTimeConstant = 0.72;
    this.playback.connect(this.outputAnalyser);
    this.outputAnalyser.connect(context.destination);
    this.startOutputMeter();
  }

  private startOutputMeter(): void {
    const analyser = this.outputAnalyser;
    if (!analyser) return;
    const samples = new Uint8Array(analyser.fftSize);
    let smoothed = 0;
    let lastUpdate = 0;
    const update = () => {
      if (this.closing || this.outputAnalyser !== analyser) return;
      analyser.getByteTimeDomainData(samples);
      let sumSquares = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const target = Math.min(1, Math.sqrt(sumSquares / samples.length) * 5);
      smoothed += (target - smoothed) * (target > smoothed ? 0.55 : 0.16);
      const now = performance.now();
      if (now - lastUpdate >= 32) {
        this.callbacks.onOutputLevel(smoothed);
        lastUpdate = now;
      }
      this.outputMeterFrame = requestAnimationFrame(update);
    };
    this.outputMeterFrame = requestAnimationFrame(update);
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
        const id =
          "item_id" in event && typeof event.item_id === "string"
            ? event.item_id
            : typeof event.response_id === "string"
              ? event.response_id
              : "assistant";
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (!delta) break;
        const text = `${this.assistantText.get(id) ?? ""}${delta}`;
        this.assistantText.set(id, text);
        this.callbacks.onTranscript({ id, role: "assistant", text, partial: true });
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const id =
          "item_id" in event && typeof event.item_id === "string"
            ? event.item_id
            : typeof event.response_id === "string"
              ? event.response_id
              : "assistant";
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
        this.callbacks.onStatus("listening");
        break;
    }
  }
}
