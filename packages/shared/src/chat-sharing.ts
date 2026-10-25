import type { UIMessage } from "ai";
import type { OpenUIFormState } from "./openui";

export type ChatShare = {
  id: string;
  chatId: string;
  /** Configured public server address, when available. */
  url?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type SharedConversation = {
  title: string;
  messages: UIMessage[];
  updatedAt?: string;
};

export type SharedConversationPage = SharedConversation & {
  nextCursor: string | null;
  formStates: Array<[string, OpenUIFormState]>;
};
