import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { UIMessage } from "ai";
import type { ChatKind } from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";

export type ChatMessagesResponse = {
  messages: UIMessage[];
  projectId: string | null;
  kind: ChatKind;
  modelConfigId?: string | null;
};

export function useChatMessages(chatId: string | null) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const query = useQuery({
    queryKey: chatId ? queryKeys.chatMessages(chatId) : ["chat", "messages", "none"],
    enabled: !!chatId,
    queryFn: async (): Promise<ChatMessagesResponse> => {
      const res = await authFetch(`${getApiBase()}/api/chat/${chatId}/messages?openui=1`);
      if (!res.ok) throw new Error(`Failed to load chat (${res.status})`);
      return (await res.json()) as ChatMessagesResponse;
    },
  });
  const { refetch } = query;
  // Background hydration/recovery must not activate the native pull indicator.
  const refresh = useCallback(async () => {
    if (!chatId || refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      return await refetch();
    } finally {
      refreshLock.current = false;
      setRefreshing(false);
    }
  }, [chatId, refetch]);
  return { ...query, refreshing, refresh };
}
