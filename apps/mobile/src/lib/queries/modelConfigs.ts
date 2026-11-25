import { i18n } from "@overtchat/shared/i18n";
import { useQuery } from "@tanstack/react-query";
import type { PublicModelConfig } from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";

export function useModelConfigs() {
  return useQuery({
    queryKey: queryKeys.modelConfigs(),
    queryFn: async (): Promise<PublicModelConfig[]> => {
      const res = await authFetch(`${getApiBase()}/api/model-configs`);
      if (!res.ok) throw new Error(i18n.t("common.mobile.errors.loadModels", { status: res.status }));
      const json = (await res.json()) as { modelConfigs: PublicModelConfig[] };
      return json.modelConfigs;
    },
    staleTime: 60_000,
  });
}
