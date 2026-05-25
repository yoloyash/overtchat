import { createContext, useContext } from "react";

export type ChatSession = {
  activeChatId: string;
  isNewChat: boolean;
  /**
   * Project the current new-chat draft is scoped to. Only meaningful while
   * `isNewChat` is true; for hydrated chats the chat row's own `projectId`
   * is the source of truth.
   */
  activeProjectId: string | null;
  startNewChat: (projectId?: string | null) => void;
  openChat: (id: string) => void;
};

export const ChatSessionContext = createContext<ChatSession | null>(null);

export function useChatSession(): ChatSession {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSession must be used inside ChatSessionContext");
  return ctx;
}
