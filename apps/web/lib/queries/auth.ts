import { getChatQueueStore } from "@overtchat/shared";
import { useCallback } from "react";
import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { authClient } from "@/lib/auth/client";
import { apiUrl } from "@/lib/api-url";
import { authKeys } from "@/lib/queries/keys";

export type AuthSession = typeof authClient.$Infer.Session;

/** The signed-in session, or null. Routes read it before rendering protected pages. */
export const sessionQuery = queryOptions({
  queryKey: authKeys.session(),
  queryFn: async (): Promise<AuthSession | null> => {
    const { data, error } = await authClient.getSession();
    if (error) throw new Error(error.message ?? `HTTP ${error.status}`);
    return data;
  },
});

/** Whether the server has no users yet, so the first signup creates the admin. */
export async function fetchSetupRequired(): Promise<boolean> {
  const response = await fetch(apiUrl("/api/setup"), { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return ((await response.json()) as { required: boolean }).required;
}

/**
 * Drops data cached for the previous user. Call after signing in or out,
 * before navigating, so routes load the new session's data.
 */
export function useResetAuthState() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(() => {
    getChatQueueStore(queryClient).clear();
    queryClient.clear();
    router.clearCache();
  }, [queryClient, router]);
}
