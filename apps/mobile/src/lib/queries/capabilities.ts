import { i18n } from "@overtchat/shared/i18n";
import { useQuery } from "@tanstack/react-query";
import type { ImageCapability, VoiceCapability } from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "./keys";

export function useCapabilities() {
  return useQuery({
    queryKey: queryKeys.capabilities(),
    queryFn: async (): Promise<{
      capabilities: {
        images?: ImageCapability;
        voice?: VoiceCapability;
        chatPinning?: boolean;
        scheduledTasks?: boolean;
      };
    }> => {
      const response = await authFetch(`${getApiBase()}/api/capabilities`);
      if (!response.ok) throw new Error(i18n.t("common.mobile.errors.loadCapabilities"));
      return response.json();
    },
    staleTime: 30_000,
  });
}
