"use client";
import { OvertChatVoiceClient as VoiceClient, type VoiceAudio, type VoiceClientCallbacks } from "@overtchat/voice-client";
import type { VoiceSessionGrant } from "@overtchat/shared";
import { apiUrl } from "@/lib/api-url";
export type { VoiceClientStatus, VoiceClientCallbacks } from "@overtchat/voice-client";
const AUDIO_SAMPLE_RATE = 24_000;
const MIC_CHUNK_MS = 40;

export class OvertChatVoiceClient extends VoiceClient {
  constructor(grant: VoiceSessionGrant, callbacks: VoiceClientCallbacks) {
    super(grant, callbacks, {
      audio: new BrowserVoiceAudio(callbacks),
      websocketUrl: (path) => {
        const url = new URL(apiUrl(path), window.location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        return url.href;
      },
      fetch: (path, init) => fetch(apiUrl(path), init),
    });
  }
}

class BrowserVoiceAudio implements VoiceAudio {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private playback: AudioWorkletNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private outputMeterFrame: number | null = null;
  private closing = false;
  private muted = false;
  private onCapture?: (data: ArrayBuffer) => void;
  constructor(private readonly callbacks: VoiceClientCallbacks) {}
  async start(onAudio: (data: ArrayBuffer) => void) {
    this.onCapture = onAudio;
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } });
    if (this.closing) return this.close();
    await this.setupAudio();
    if (this.closing) await this.close();
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    this.capture?.port.postMessage({ kind: "enable", value: !muted });
    for (const track of this.mediaStream?.getAudioTracks() ?? []) track.enabled = !muted;
  }
  play(buffer: ArrayBuffer) {
    if (!this.playback || this.closing) return;
    const view = new DataView(buffer);
    const samples = new Float32Array(buffer.byteLength / 2);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = view.getInt16(index * 2, true);
      samples[index] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
    }
    this.playback.port.postMessage({ kind: "audio", samples }, [samples.buffer]);
  }
  clear() { this.playback?.port.postMessage({ kind: "clear" }); }
  async close() {
    this.closing = true;
    this.clear();
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
        if (!this.muted) this.onCapture?.(event.data);
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

}
