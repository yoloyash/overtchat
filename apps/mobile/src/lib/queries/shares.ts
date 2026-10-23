import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatShare, SharedConversation } from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "./keys";

export async function requestChatShare(
  server: string,
  chatId: string,
  method = "GET",
) {
  const response = await authFetch(
    `${server}/api/chat/${encodeURIComponent(chatId)}/share`,
    { method },
  );
  if (!response.ok)
    throw new Error(
      (await response.text()) || "Could not change chat sharing.",
    );
  return response.json() as Promise<{ share: ChatShare | null }>;
}

export function useChatShare(chatId: string) {
  const server = getApiBase();
  return useQuery({
    queryKey: queryKeys.chatShare(server, chatId),
    queryFn: () => requestChatShare(server, chatId),
    staleTime: 0,
  });
}

export function useSharePreview(chatId: string) {
  const server = getApiBase();
  return useQuery({
    queryKey: queryKeys.sharePreview(server, chatId),
    queryFn: async (): Promise<SharedConversation> => {
      const response = await authFetch(
        `${server}/api/chat/${encodeURIComponent(chatId)}/share/preview`,
      );
      if (!response.ok)
        throw new Error(
          (await response.text()) || "Could not preview this chat.",
        );
      return response.json();
    },
    staleTime: 0,
    retry: false,
  });
}

export function useChangeChatShare(chatId: string) {
  const server = getApiBase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (method: "POST" | "PUT" | "DELETE") =>
      requestChatShare(server, chatId, method),
    onSuccess: (data) =>
      qc.setQueryData(queryKeys.chatShare(server, chatId), data),
  });
}
