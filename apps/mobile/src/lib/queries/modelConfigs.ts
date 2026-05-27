import { useQuery } from "@tanstack/react-query";
import type { PublicModelConfig } from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";

export function useModelConfigs() {
  return useQuery({
    queryKey: queryKeys.modelConfigs(),
    queryFn: async (): Promise<PublicModelConfig[]> => {
      const res = await authFetch(`${getApiBase()}/api/model-configs`);
      if (!res.ok) throw new Error(`Failed to load models (${res.status})`);
      const json = (await res.json()) as { modelConfigs: PublicModelConfig[] };
      return json.modelConfigs;
    },
    staleTime: 60_000,
  });
}
