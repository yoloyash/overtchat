export const VOICE_REALTIME_PATH = "/api/voice/realtime" as const;

export type VoiceUnavailableReason =
  | "not-installed"
  | "stt-unavailable"
  | "tts-unavailable"
  | "not-configured";

export interface VoiceSessionGrant {
  token: string;
  sessionId: string;
  chatId: string;
  endpoint: typeof VOICE_REALTIME_PATH;
  voice: string;
}

export interface VoiceCapability {
  available: boolean;
  installed: boolean;
  unavailableReason: VoiceUnavailableReason | null;
}
