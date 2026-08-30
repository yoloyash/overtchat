"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { CHAT_MESSAGE_PAGE_SIZE } from "@/lib/chat/history";
import { chatKeys } from "@/lib/queries/keys";
import type { ChatUsageResponse, UsageTotals } from "@/lib/usage/types";
import {
  chatComposerDraftScope,
  clearComposerDraftScope,
} from "@/lib/chat/composer-drafts";

export type ChatListItem = {
  id: string;
  title: string | null;
  projectId: string | null;
  updatedAt: number;
};

async function fetchChats(): Promise<ChatListItem[]> {
  const r = await fetch("/api/chats");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = (await r.json()) as { chats: ChatListItem[] };
  return json.chats;
}

export function useChats() {
  return useQuery({
    queryKey: chatKeys.list(),
    queryFn: fetchChats,
  });
}

export function useChatUsage(id: string, enabled = true) {
  return useQuery({
    queryKey: chatKeys.usage(id),
    queryFn: async (): Promise<UsageTotals> => {
      const response = await fetch(
        `/api/chat/${encodeURIComponent(id)}/usage`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as ChatUsageResponse;
      return body.usage;
    },
    enabled,
  });
}

export function useLoadOlderChatMessages(id: string) {
  return useMutation({
    mutationFn: async (cursor: string) => {
      const params = new URLSearchParams({
        cursor,
        limit: String(CHAT_MESSAGE_PAGE_SIZE),
      });
      const response = await fetch(
        `/api/chat/${encodeURIComponent(id)}/messages?${params}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as {
        messages: UIMessage[];
        nextCursor: string | null;
        projectId: string | null;
      };
    },
  });
}

export function useRenameChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const r = await fetch(`/api/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.list() }),
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/chats/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: (_, id) => {
      clearComposerDraftScope(chatComposerDraftScope(id));
      return qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
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
      const r = await fetch(`/api/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.list() }),
  });
}
