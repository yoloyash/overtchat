import { useQuery } from "@tanstack/react-query";
import type { ImageCapability } from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "./keys";

export function useCapabilities() {
  return useQuery({
    queryKey: queryKeys.capabilities(),
    queryFn: async (): Promise<{
      capabilities: { images?: ImageCapability };
    }> => {
      const response = await authFetch(`${getApiBase()}/api/capabilities`);
      if (!response.ok) throw new Error("Could not load server capabilities.");
      return response.json();
    },
    staleTime: 30_000,
  });
}
