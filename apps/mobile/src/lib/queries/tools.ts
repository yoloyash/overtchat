import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";

export interface ToolCapabilities {
  webSearchEnabled: boolean;
  mcpServersEnabled: boolean;
}

export function useToolCapabilities() {
  return useQuery({
    queryKey: queryKeys.toolCapabilities(),
    queryFn: async (): Promise<ToolCapabilities> => {
      const res = await authFetch(`${getApiBase()}/api/tools/capabilities`);
      if (!res.ok) throw new Error(`Failed to load tools (${res.status})`);
      return (await res.json()) as ToolCapabilities;
    },
    staleTime: 60_000,
  });
}
