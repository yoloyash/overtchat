import { useQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";

export type ChatMessagesResponse = {
  messages: UIMessage[];
  projectId: string | null;
};

export function useChatMessages(chatId: string | null) {
  return useQuery({
    queryKey: chatId ? queryKeys.chatMessages(chatId) : ["chat", "messages", "none"],
    enabled: !!chatId,
    queryFn: async (): Promise<ChatMessagesResponse> => {
      const res = await authFetch(`${getApiBase()}/api/chat/${chatId}/messages`);
      if (!res.ok) throw new Error(`Failed to load chat (${res.status})`);
      return (await res.json()) as ChatMessagesResponse;
    },
  });
}
