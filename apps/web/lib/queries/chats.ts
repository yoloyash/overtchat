"use client";

import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { UIMessage } from "ai";
import type { ChatKind } from "@overtchat/shared";
import { CHAT_MESSAGE_PAGE_SIZE } from "@/lib/chat/history";
import { chatKeys, libraryKeys } from "@/lib/queries/keys";
import type { ChatUsageResponse, UsageTotals } from "@/lib/usage/types";
import { apiUrl } from "@/lib/api-url";

export type ChatListItem = {
  id: string;
  title: string | null;
  pinned?: boolean;
  kind: ChatKind;
  projectId: string | null;
  updatedAt: number;
};

export type ActiveChatIdsResponse = {
  activeChatIds: string[];
};

export const ACTIVE_CHATS_POLL_MS = 2_000;

async function fetchChats(): Promise<ChatListItem[]> {
  const r = await fetch(apiUrl("/api/chats"));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = (await r.json()) as { chats: ChatListItem[] };
  return json.chats;
}

export const chatListQuery = queryOptions({
  queryKey: chatKeys.list(),
  queryFn: fetchChats,
});

export function useChats() {
  return useQuery(chatListQuery);
}

async function fetchActiveChatIds(): Promise<string[]> {
  const response = await fetch(apiUrl("/api/chats/active"), { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as ActiveChatIdsResponse;
  return body.activeChatIds;
}

export function activeChatsRefetchInterval(
  activeChatIds: string[] | undefined,
): number | false {
  return activeChatIds && activeChatIds.length > 0
    ? ACTIVE_CHATS_POLL_MS
    : false;
}

export const activeChatIdsQuery = queryOptions({
  queryKey: chatKeys.active(),
  queryFn: fetchActiveChatIds,
});

export function useActiveChatIds() {
  return useQuery({
    ...activeChatIdsQuery,
    staleTime: 1_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: (query) => activeChatsRefetchInterval(query.state.data),
    retry: false,
  });
}

export function setActiveChatInCache(
  queryClient: QueryClient,
  chatId: string,
  active: boolean,
) {
  queryClient.setQueryData<string[]>(chatKeys.active(), (current = []) => {
    const containsChat = current.includes(chatId);
    if (active) return containsChat ? current : [...current, chatId];
    return containsChat ? current.filter((id) => id !== chatId) : current;
  });
}

export function useChatUsage(id: string, enabled = true) {
  return useQuery({
    queryKey: chatKeys.usage(id),
    queryFn: async (): Promise<UsageTotals> => {
      const response = await fetch(
        apiUrl(`/api/chat/${encodeURIComponent(id)}/usage`),
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as ChatUsageResponse;
      return body.usage;
    },
    enabled,
  });
}

export type ChatMessagesPage = {
  messages: UIMessage[];
  nextCursor: string | null;
  projectId: string | null;
  kind: ChatKind;
  modelConfigId: string | null;
};

/** Fetches one page of a chat's history, newest first. Null when the chat does not exist. */
export async function fetchChatMessagesPage(
  id: string,
  cursor?: string,
): Promise<ChatMessagesPage | null> {
  const params = new URLSearchParams({
    ...(cursor ? { cursor } : {}),
    limit: String(CHAT_MESSAGE_PAGE_SIZE),
  });
  const response = await fetch(
    apiUrl(`/api/chat/${encodeURIComponent(id)}/messages?${params}`),
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as ChatMessagesPage;
}

export function useLoadOlderChatMessages(id: string) {
  return useMutation({
    mutationFn: async (cursor: string) => {
      const page = await fetchChatMessagesPage(id, cursor);
      if (!page) throw new Error("HTTP 404");
      return page;
    },
  });
}

export function useRenameChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const r = await fetch(apiUrl(`/api/chats/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.list() }),
  });
}

export function useSetChatPinned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const response = await fetch(apiUrl(`/api/chats/${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.list() }),
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(apiUrl(`/api/chats/${id}`), { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: chatKeys.list() }),
      qc.invalidateQueries({ queryKey: libraryKeys.all() }),
    ]),
  });
}

export function useMoveChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      projectId,
    }: {
      id: string;
      projectId: string | null;
    }) => {
      const r = await fetch(apiUrl(`/api/chats/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.list() }),
  });
}
