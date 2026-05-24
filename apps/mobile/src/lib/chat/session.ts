import { createContext, useContext } from "react";

export type ChatSession = {
  activeChatId: string;
  isNewChat: boolean;
  startNewChat: () => void;
  openChat: (id: string) => void;
};

export const ChatSessionContext = createContext<ChatSession | null>(null);

export function useChatSession(): ChatSession {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSession must be used inside ChatSessionContext");
  return ctx;
}
