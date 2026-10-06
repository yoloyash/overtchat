"use client";

import {
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
import { apiUrl } from "@/lib/api-url";
import {
  VoicePlaybackTransport,
  audioItemKey,
  type PlaybackEvent,
  type VoiceAudioItem,
} from "@/lib/voice/playback-transport";

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
  onWarning?: (message: string | null) => void;
  onToolActivity: (activity: VoiceToolActivityUpdate) => void;
  onHistoryItems?: (items: VoiceHistoryItem[]) => void;
}

const AUDIO_SAMPLE_RATE = 24_000;
const MIC_CHUNK_MS = 40;

function websocketUrl(path: string): string {
  const url = new URL(apiUrl(path), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

interface VoiceToolResult {
  output: string;
  sources: WebSearchResult[];
  failed: boolean;
}

function historyFingerprint(item: VoiceHistoryItem): string {
  return item.type === "message"
    ? JSON.stringify({
        type: item.type,
        id: item.id,
        role: item.role,
        status: item.status,
        text: item.text,
      })
    : JSON.stringify({
        type: item.type,
        id: item.id,
        name: item.name,
        status: item.status,
        input: item.input,
        output: item.output,
      });
}

async function executeVoiceTool(
  name: string,
  input: unknown,
): Promise<VoiceToolResult> {
  try {
    const response = await fetch(apiUrl("/api/voice/tools"), {
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
  private transport: VoicePlaybackTransport | null = null;
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
  // Notification deduplication only. HistorySync separately tracks server ACKs.
  private emittedHistory = new Map<string, string>();
  private currentAudio: VoiceAudioItem | null = null;
  private pendingAudio = new Map<string, VoiceAudioItem>();
  private interruptedResponses = new Set<string>();
  private truncatedItems = new Set<string>();
  private activeResponse: string | null = null;
  private userSpeaking = false;
  private awaitingResponse = false;

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

    this.transport = new VoicePlaybackTransport(
      () => this.interruptPlayback(),
      { useInsecureApiKey: true },
    );
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
        void this.close();
      }
    });
    this.session.on("audio", (event) => this.onAudio(event.data));
    this.session.on("history_updated", (history) => {
      this.emitHistoryItems(completedVoiceHistory(history));
    });
    this.session.on("error", () => {
      // Provider error payloads can contain request bodies or credentials.
      this.turnFailed("The voice response failed. Please try speaking again.");
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
    this.session?.interrupt();
  }

  sendMessage(text: string): void {
    const value = text.trim();
    if (!value || !this.session) return;
    this.callbacks.onWarning?.(null);
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
    this.playback.port.onmessage = (event: MessageEvent<PlaybackEvent>) => {
      this.onPlaybackEvent(event.data);
    };
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
    const item = this.currentAudio;
    if (!this.playback || !item || !buffer.byteLength || this.interruptedResponses.has(item.responseId)) return;
    const view = new DataView(buffer);
    const samples = new Float32Array(buffer.byteLength / 2);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = view.getInt16(index * 2, true);
      samples[index] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
    }
    this.pendingAudio.set(audioItemKey(item), item);
    this.playback.port.postMessage({ kind: "audio", samples, item }, [samples.buffer]);
    this.updateStatus();
  }

  private clearPlayback(): void {
    this.playback?.port.postMessage({ kind: "clear" });
    this.pendingAudio.clear();
  }

  private interruptPlayback(): void {
    if (this.activeResponse) this.interruptedResponses.add(this.activeResponse);
    for (const item of this.pendingAudio.values()) this.interruptedResponses.add(item.responseId);
    this.activeResponse = null;
    this.awaitingResponse = false;
    this.pendingAudio.clear();
    // The worklet snapshots played samples when it actually clears its queue.
    this.playback?.port.postMessage({ kind: "interrupt" });
    this.updateStatus();
  }

  private onPlaybackEvent(event: PlaybackEvent): void {
    if (this.closing) return;
    if (event.kind === "drained") {
      this.pendingAudio.delete(audioItemKey(event.item));
      this.updateStatus();
    } else if (event.kind === "interrupted" && this.transport?.status === "connected") {
      for (const item of event.items) {
        this.transport.sendEvent({
          type: "conversation.item.truncate",
          item_id: item.itemId,
          content_index: item.contentIndex,
          audio_end_ms: Math.max(0, Math.floor(item.playedSamples / AUDIO_SAMPLE_RATE * 1000)),
        });
      }
    }
  }

  private updateStatus(): void {
    if (this.closing) return;
    this.callbacks.onStatus(this.userSpeaking ? "user-speaking"
      : this.pendingAudio.size ? "assistant-speaking"
        : this.activeResponse || this.awaitingResponse ? "thinking" : "listening");
  }

  private turnFailed(message: string): void {
    if (this.closing) return;
    this.callbacks.onWarning?.(message);
    this.awaitingResponse = false;
    this.updateStatus();
  }

  private onTransportEvent(event: TransportEvent): void {
    switch (event.type) {
      case "input_audio_buffer.speech_started": {
        this.callbacks.onWarning?.(null);
        this.userSpeaking = true;
        this.currentUserItem = typeof event.item_id === "string" ? event.item_id : "";
        this.callbacks.onStatus("user-speaking");
        break;
      }
      case "input_audio_buffer.speech_stopped":
        this.userSpeaking = false;
        this.awaitingResponse = true;
        this.updateStatus();
        break;
      case "conversation.item.input_audio_transcription.failed":
        if (typeof event.item_id === "string") this.userText.delete(event.item_id);
        this.turnFailed("Your speech could not be transcribed. Please try speaking again.");
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
          this.emitHistoryItems([
            {
              type: "message",
              id,
              previousId: null,
              role: "user",
              status: "completed",
              text,
            },
          ]);
        }
        break;
      }
      case "response.created":
        this.activeResponse = typeof event.response?.id === "string" ? event.response.id : null;
        this.awaitingResponse = false;
        this.updateStatus();
        break;
      case "response.output_audio.delta":
        this.currentAudio = {
          itemId: event.item_id,
          contentIndex: event.content_index,
          responseId: event.response_id,
        };
        break;
      case "response.output_audio.done":
        this.playback?.port.postMessage({ kind: "done", item: {
          itemId: event.item_id,
          contentIndex: event.content_index,
          responseId: event.response_id,
        } });
        break;
      case "conversation.item.truncated": {
        const id = event.item_id;
        this.truncatedItems.add(id);
        this.assistantText.delete(id);
        const text = "[Assistant interrupted]";
        this.callbacks.onTranscript({ id, role: "assistant", text, partial: false });
        this.emitHistoryItems([{ type: "message", id, previousId: null,
          role: "assistant", status: "incomplete", text }]);
        break;
      }
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const id =
          "item_id" in event && typeof event.item_id === "string"
            ? event.item_id
            : typeof event.response_id === "string"
              ? event.response_id
              : "assistant";
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (!delta || this.truncatedItems.has(id)) break;
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
        if (text && !this.truncatedItems.has(id)) {
          this.assistantText.delete(id);
          this.callbacks.onTranscript({ id, role: "assistant", text, partial: false });
          this.emitHistoryItems([
            {
              type: "message",
              id,
              previousId: null,
              role: "assistant",
              status: "completed",
              text,
            },
          ]);
        }
        break;
      }
      case "response.done":
        if (event.response?.id === this.activeResponse) this.activeResponse = null;
        this.awaitingResponse = false;
        if (event.response?.status === "failed") {
          this.turnFailed("The voice response failed. Please try speaking again.");
        }
        this.updateStatus();
        break;
    }
  }

  private emitHistoryItems(items: VoiceHistoryItem[]): void {
    items = items.map((item) => item.type === "message" && this.truncatedItems.has(item.id)
      ? { ...item, status: "incomplete", text: "[Assistant interrupted]" }
      : item);
    const changed = items.filter((item) => {
      const serialized = historyFingerprint(item);
      if (this.emittedHistory.get(item.id) === serialized) return false;
      this.emittedHistory.set(item.id, serialized);
      return true;
    });
    if (changed.length) this.callbacks.onHistoryItems?.(changed);
  }
}
