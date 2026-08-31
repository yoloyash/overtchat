import type { UIMessage } from "ai";

export const CHAT_KINDS = ["text", "voice"] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export type ChatRequestAction =
  | { type: "submit" }
  | { type: "edit"; targetUserMessageId: string }
  | { type: "regenerate"; targetAssistantMessageId: string }
  | { type: "retry"; userMessageId: string };

export interface ChatRequestBody {
  messages: UIMessage[];
  modelConfigId: string;
  chatId: string;
  action: ChatRequestAction;
  webSearchEnabled?: boolean;
  forceSearch?: boolean;
  timeZone?: string;
  projectId?: string | null;
  temporary?: boolean;
}
