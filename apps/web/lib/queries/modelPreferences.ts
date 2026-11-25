"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelPreferences } from "@overtchat/shared";
import { i18n } from "@overtchat/shared/i18n";
import { authClient } from "@/lib/auth/client";
import { modelPreferenceKeys } from "@/lib/queries/keys";
import { apiUrl } from "@/lib/api-url";

export function useModelPreferences() {
  const { data: session } = authClient.useSession();
  return useQuery({
    queryKey: modelPreferenceKeys.detail(session?.user.id ?? ""),
    enabled: !!session,
    staleTime: 0,
    queryFn: async ({ signal }): Promise<ModelPreferences> => {
      const response = await fetch(apiUrl("/api/model-preferences"), { signal });
      if (!response.ok) throw new Error(i18n.t("models.editor.errors.loadDefaultModelFailed"));
      return response.json();
    },
  });
}

export function useSetDefaultModel() {
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  return useMutation({
    mutationFn: async (input: {
      defaultModelId: string | null;
    }): Promise<ModelPreferences> => {
      const response = await fetch(apiUrl("/api/model-preferences"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(i18n.t("models.editor.errors.saveDefaultModelFailed"));
      return response.json();
    },
    onSuccess: async (preferences) => {
      // A refresh started before this save must not replace the newer result.
      await qc.cancelQueries({
        queryKey: modelPreferenceKeys.detail(session?.user.id ?? ""),
      });
      qc.setQueryData(
        modelPreferenceKeys.detail(session?.user.id ?? ""),
        preferences,
      );
    },
  });
}
