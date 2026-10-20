import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getChatQueueStore, type ChatKind } from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";

export type ChatListItem = {
  id: string;
  title: string | null;
  pinned?: boolean;
  kind: ChatKind;
  projectId: string | null;
  updatedAt: number;
};

export function useChats() {
  return useQuery({
    queryKey: queryKeys.chats(),
    queryFn: async (): Promise<ChatListItem[]> => {
      const res = await authFetch(`${getApiBase()}/api/chats`);
      if (!res.ok) throw new Error(`Failed to load chats (${res.status})`);
      const json = (await res.json()) as { chats: ChatListItem[] };
      return json.chats;
    },
    staleTime: 30_000,
  });
}

export function useRenameChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await authFetch(`${getApiBase()}/api/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error(`Failed to rename (${res.status})`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.chats() }),
  });
}

export function useSetChatPinned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const res = await authFetch(`${getApiBase()}/api/chats/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      if (!res.ok) throw new Error(`Failed to update pin (${res.status})`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.chats() }),
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`${getApiBase()}/api/chats/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed to delete (${res.status})`);
    },
    onSuccess: (_, id) => {
      getChatQueueStore(qc).deleteChat(id);
      return qc.invalidateQueries({ queryKey: queryKeys.chats() });
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
      const res = await authFetch(`${getApiBase()}/api/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error(`Failed to move (${res.status})`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.chats() }),
  });
}
