export const VOICE_REALTIME_PATH = "/api/voice/realtime" as const;

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
  endpoint: typeof VOICE_REALTIME_PATH;
  voice: string;
  tools: VoiceToolDefinition[];
}

export interface VoiceCapability {
  available: boolean;
  installed: boolean;
  unavailableReason: VoiceUnavailableReason | null;
}
