"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { searchKeys } from "@/lib/queries/keys";

export type SearchHit = {
  chatId: string;
  title: string | null;
  updatedAt: number;
  snippet: string | null;
  messageId: string | null;
};

export function useChatsSearch(query: string) {
  const enabled = query.trim().length >= 2;
  return useQuery({
    queryKey: searchKeys.byQuery(query.trim()),
    queryFn: async ({ signal }): Promise<SearchHit[]> => {
      const r = await fetch(
        `/api/search?q=${encodeURIComponent(query.trim())}`,
        { signal },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { hits: SearchHit[] };
      return json.hits;
    },
    enabled,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });
}
