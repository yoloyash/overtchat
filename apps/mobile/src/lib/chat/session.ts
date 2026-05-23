import { createContext, useContext } from "react";

export type ChatSession = {
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  newChatKey: number;
  bumpNewChat: () => void;
};

export const ChatSessionContext = createContext<ChatSession | null>(null);

export function useChatSession(): ChatSession {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSession must be used inside ChatSessionContext");
  return ctx;
}
