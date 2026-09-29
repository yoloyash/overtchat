import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelPreferences } from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { getAuthClient } from "@/lib/auth/client";
import { queryKeys } from "@/lib/queries/keys";

export function useModelPreferences() {
  const { data: session } = getAuthClient().useSession();
  return useQuery({
    queryKey: queryKeys.modelPreferences(getApiBase(), session?.user.id ?? ""),
    enabled: !!session,
    staleTime: 0,
    queryFn: async ({ signal }): Promise<ModelPreferences> => {
      const response = await authFetch(
        `${getApiBase()}/api/model-preferences`,
        {
          signal,
        },
      );
      if (!response.ok) throw new Error("Couldn't load default model");
      return response.json();
    },
  });
}

export function useSetDefaultModel() {
  const qc = useQueryClient();
  const { data: session } = getAuthClient().useSession();
  return useMutation({
    mutationFn: async (input: {
      defaultModelId: string | null;
    }): Promise<ModelPreferences> => {
      const response = await authFetch(
        `${getApiBase()}/api/model-preferences`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) throw new Error("Couldn't save default model");
      return response.json();
    },
    onSuccess: async (preferences) => {
      // A refresh started before this save must not replace the newer result.
      await qc.cancelQueries({
        queryKey: queryKeys.modelPreferences(
          getApiBase(),
          session?.user.id ?? "",
        ),
      });
      qc.setQueryData(
        queryKeys.modelPreferences(getApiBase(), session?.user.id ?? ""),
        preferences,
      );
    },
  });
}
