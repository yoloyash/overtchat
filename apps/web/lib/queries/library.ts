"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { i18n } from "@overtchat/shared/i18n";
import { libraryKeys } from "@/lib/queries/keys";
import type { LibraryPage } from "@/lib/library";
import { apiUrl } from "@/lib/api-url";

export function useLibrary(query: string) {
  return useInfiniteQuery({
    queryKey: libraryKeys.list(query),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<LibraryPage> => {
      const params = new URLSearchParams({ q: query });
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(apiUrl(`/api/library?${params}`), { signal });
      if (!response.ok) throw new Error(i18n.t("library.browser.loadError"));
      return response.json();
    },
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
