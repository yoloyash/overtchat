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
  chatId: string;
  endpoint: typeof VOICE_REALTIME_PATH;
  voice: string;
  tools: VoiceToolDefinition[];
}

export type VoiceHistoryStatus = "completed" | "incomplete";

export type VoiceHistoryItem =
  | {
      type: "message";
      id: string;
      previousId: string | null;
      role: "user" | "assistant";
      status: VoiceHistoryStatus;
      text: string;
    }
  | {
      type: "tool";
      id: string;
      previousId: string | null;
      name: string;
      status: VoiceHistoryStatus;
      input: unknown;
      output: unknown;
    };

export interface VoiceCapability {
  available: boolean;
  installed: boolean;
  unavailableReason: VoiceUnavailableReason | null;
}
