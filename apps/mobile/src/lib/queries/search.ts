import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SearchHit } from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";

export type { SearchHit };

export function useChatsSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: queryKeys.search(trimmed),
    queryFn: async ({ signal }): Promise<SearchHit[]> => {
      const res = await authFetch(
        `${getApiBase()}/api/search?q=${encodeURIComponent(trimmed)}`,
        { signal },
      );
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const json = (await res.json()) as { hits: SearchHit[] };
      return json.hits;
    },
    enabled: trimmed.length >= 2,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });
}
