import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiUrl, getApiOrigin } from "@/lib/api-url";
import type { ChatShare, SharedConversation } from "@/lib/sharing";
import { shareKeys } from "./keys";

async function request<T>(path: string, method = "GET"): Promise<T> {
  const response = await fetch(apiUrl(path), { method, cache: "no-store" });
  if (!response.ok)
    throw new Error((await response.text()) || `HTTP ${response.status}`);
  return response.json();
}

export function shareUrl(id: string) {
  return `${getApiOrigin() || window.location.origin}/share/${encodeURIComponent(id)}`;
}

export const sharesQuery = queryOptions({
  queryKey: shareKeys.all(),
  queryFn: () => request<{ shares: ChatShare[] }>("/api/shares"),
  staleTime: 0,
});

export const chatShareQuery = (id: string) =>
  queryOptions({
    queryKey: shareKeys.chat(id),
    queryFn: () =>
      request<{ share: ChatShare | null }>(
        `/api/chat/${encodeURIComponent(id)}/share`,
      ),
    staleTime: 0,
  });

export const sharePreviewQuery = (id: string) =>
  queryOptions({
    queryKey: shareKeys.preview(id),
    queryFn: () =>
      request<SharedConversation>(
        `/api/chat/${encodeURIComponent(id)}/share/preview`,
      ),
    staleTime: 0,
    retry: false,
  });

export const publicShareQuery = (id: string) =>
  queryOptions({
    queryKey: shareKeys.public(id),
    queryFn: async (): Promise<SharedConversation | null> => {
      const response = await fetch(
        apiUrl(`/api/share/${encodeURIComponent(id)}`),
        { cache: "no-store" },
      );
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error("Could not load the shared chat. Please try again.");
      return response.json();
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

export function useChangeChatShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      chatId,
      method,
    }: {
      chatId: string;
      method: "POST" | "PUT" | "DELETE";
    }) =>
      request<{ share: ChatShare | null }>(
        `/api/chat/${encodeURIComponent(chatId)}/share`,
        method,
      ),
    onSuccess: async (data, { chatId }) => {
      qc.setQueryData(shareKeys.chat(chatId), data);
      await qc.invalidateQueries({ queryKey: shareKeys.all() });
    },
  });
}
