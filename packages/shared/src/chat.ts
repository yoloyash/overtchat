import type { UIMessage } from "ai";

export interface ChatRequestBody {
  messages: UIMessage[];
  modelConfigId: string;
  chatId: string;
  forceSearch?: boolean;
  timeZone?: string;
  projectId?: string | null;
  trigger?: "submit-message" | "regenerate-message";
  messageId?: string;
  temporary?: boolean;
}
