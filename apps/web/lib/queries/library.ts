"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { libraryKeys } from "@/lib/queries/keys";
import type { LibraryPage } from "@/lib/library";

export function useLibrary(query: string) {
  return useInfiniteQuery({
    queryKey: libraryKeys.list(query),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<LibraryPage> => {
      const params = new URLSearchParams({ q: query });
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(`/api/library?${params}`, { signal });
      if (!response.ok) throw new Error("Could not load your library.");
      return response.json();
    },
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
