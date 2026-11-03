import {
  getChatQueueStore,
  type SignInDecision,
  type SignInDecisionResult,
  type SignInRequest,
  type TwoFactorStatus,
} from "@overtchat/shared";
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

/** The signed-in user's two-factor state, and whether the server requires it. */
export const twoFactorQuery = queryOptions({
  queryKey: authKeys.twoFactor(),
  queryFn: async (): Promise<TwoFactorStatus> => {
    const response = await fetch(apiUrl("/api/two-factor"), {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as TwoFactorStatus;
  },
});

/**
 * Sign-ins to this account waiting for approval. Polled while the page is
 * visible, so any signed-in tab or desktop window can answer. `null` when the
 * server predates sign-in approval.
 */
export const signInRequestsQuery = queryOptions({
  queryKey: authKeys.signInRequests(),
  queryFn: async (): Promise<SignInRequest[] | null> => {
    const response = await fetch(apiUrl("/api/sign-in-requests"), {
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as SignInRequest[];
  },
  refetchInterval: (query) => (query.state.data === null ? false : 4_000),
});

/** Approves or denies a sign-in from this device. */
export async function decideSignInRequest(
  id: string,
  decision: SignInDecision,
): Promise<SignInDecisionResult> {
  const response = await fetch(
    apiUrl(`/api/sign-in-requests/${encodeURIComponent(id)}`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    },
  );
  if (response.status === 404) return "expired";
  if (!response.ok && response.status !== 409) {
    throw new Error(`HTTP ${response.status}`);
  }
  return ((await response.json()) as { result: SignInDecisionResult }).result;
}

/**
 * Refreshes the session and two-factor state after enabling or disabling
 * two-factor; Better Auth replaces the session when either happens.
 */
export function useRefreshTwoFactor() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: authKeys.session() }),
        queryClient.invalidateQueries({ queryKey: authKeys.twoFactor() }),
      ]),
    [queryClient],
  );
}

/** Whether initial administrator setup is still available. */
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
