import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";

export type ChatListItem = {
  id: string;
  title: string | null;
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
