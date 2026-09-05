import type { UIMessage } from "ai";
import type { ModelCapabilities, ModelReasoningLevel } from "./models";

export const CHAT_KINDS = ["text", "voice"] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export type ChatRequestAction =
  | { type: "submit" }
  | { type: "edit"; targetUserMessageId: string }
  | { type: "regenerate"; targetAssistantMessageId: string }
  | { type: "retry"; userMessageId: string };

export type ChatReasoningLevel =
  | "default"
  | ModelReasoningLevel;

export function modelSupportsChatReasoningLevel(
  capabilities: ModelCapabilities | null | undefined,
  level: ChatReasoningLevel | undefined,
): level is ChatReasoningLevel {
  if (level === "default") return true;
  const controls = capabilities?.reasoningControls;
  if (!controls || !level) return false;
  if (level === "off" || level === "on") return controls.toggle;
  return controls.efforts?.includes(level) === true;
}

export interface ChatRequestBody {
  messages: UIMessage[];
  modelConfigId: string;
  chatId: string;
  /** Stable for one user intent and reused only when its HTTP start is retried. */
  clientRequestId: string;
  action: ChatRequestAction;
  reasoningLevel?: ChatReasoningLevel;
  webSearchEnabled?: boolean;
  forceSearch?: boolean;
  timeZone?: string;
  projectId?: string | null;
  temporary?: boolean;
}

export const CHAT_GENERATION_STATUSES = [
  "running",
  "complete",
  "error",
  "aborted",
] as const;

export type ChatGenerationStatus =
  (typeof CHAT_GENERATION_STATUSES)[number];

export interface ChatGenerationState {
  active: boolean;
  streamId: string | null;
  status: ChatGenerationStatus | "idle";
  startedAt: number | null;
  completedAt: number | null;
  responseMessage?: UIMessage;
}
