export const VOICE_REALTIME_PATH = "/api/voice/realtime" as const;

export const VOICE_AUDIO_FORMAT = {
  encoding: "pcm16",
  sampleRate: 24_000,
  channels: 1,
} as const;

export type VoiceUnavailableReason =
  | "not-installed"
  | "stt-unavailable"
  | "tts-unavailable"
  | "not-configured";

export interface VoiceToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface VoiceSessionGrant {
  token: string;
  model: string;
  endpoint: typeof VOICE_REALTIME_PATH;
  expiresAt: number;
  tools: VoiceToolDefinition[];
}

export interface VoiceCapability {
  available: boolean;
  installed: boolean;
  unavailableReason: VoiceUnavailableReason | null;
  protocol: "openai-realtime";
  transport: "websocket";
  endpoint: typeof VOICE_REALTIME_PATH | null;
  inputAudio: typeof VOICE_AUDIO_FORMAT;
  outputAudio: typeof VOICE_AUDIO_FORMAT;
}
