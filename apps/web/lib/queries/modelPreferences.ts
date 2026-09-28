"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelPreferences } from "@overtchat/shared";
import { authClient } from "@/lib/auth/client";
import { modelPreferenceKeys } from "@/lib/queries/keys";

export function useModelPreferences() {
  const { data: session } = authClient.useSession();
  return useQuery({
    queryKey: modelPreferenceKeys.detail(session?.user.id ?? ""),
    enabled: !!session,
    queryFn: async ({ signal }): Promise<ModelPreferences> => {
      const response = await fetch("/api/model-preferences", { signal });
      if (!response.ok) throw new Error("Couldn't load model favorites");
      return response.json();
    },
  });
}

export function useSetModelFavorite() {
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  return useMutation({
    mutationFn: async (input: {
      modelConfigId: string;
      favorite: boolean;
    }): Promise<ModelPreferences> => {
      const response = await fetch("/api/model-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Couldn't save model favorites");
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
