import type { UIMessage } from "ai";

export type ChatShare = {
  id: string;
  chatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type SharedConversation = {
  title: string;
  messages: UIMessage[];
  updatedAt?: string;
};
