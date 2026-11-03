import { useQuery } from "@tanstack/react-query";
import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type {
  SignInDecision,
  SignInDecisionResult,
  SignInRequest,
} from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "./keys";

function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => listener.remove();
  }, []);
  return active;
}

/**
 * Sign-ins to this account waiting for approval, checked while the app is in
 * the foreground. `null` when the server predates sign-in approval.
 */
export function useSignInRequests({ enabled }: { enabled: boolean }) {
  const active = useAppActive();
  return useQuery({
    queryKey: queryKeys.signInRequests(getApiBase()),
    queryFn: async ({ signal }): Promise<SignInRequest[] | null> => {
      const response = await authFetch(`${getApiBase()}/api/sign-in-requests`, {
        signal,
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Could not load sign-in requests.");
      return response.json();
    },
    enabled: enabled && active,
    refetchInterval: (query) =>
      query.state.data === null ? false : 5_000,
  });
}

/** Approves or denies a sign-in from this device. */
export async function decideSignInRequest(
  id: string,
  decision: SignInDecision,
): Promise<SignInDecisionResult> {
  const response = await authFetch(
    `${getApiBase()}/api/sign-in-requests/${encodeURIComponent(id)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    },
  );
  if (response.status === 404) return "expired";
  if (!response.ok && response.status !== 409) {
    throw new Error("Couldn't answer the sign-in request. Try again.");
  }
  return ((await response.json()) as { result: SignInDecisionResult }).result;
}

const SCREEN = "/sign-in-request";
const shown = new Set<string>();

export function markSignInRequestShown(id: string) {
  shown.add(id);
}

/**
 * Opens the approval screen for a request. Without `again`, a request the user
 * already saw and closed isn't shown a second time.
 */
export function showSignInRequest(id: string, { again = false } = {}) {
  if (shown.has(id) && !again) return;
  shown.add(id);
  router.navigate({ pathname: SCREEN, params: { id } });
}

/** While the app is open, asks about each new sign-in request as it arrives. */
export function useSignInRequestPrompt({ enabled }: { enabled: boolean }) {
  const { data } = useSignInRequests({ enabled });
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === SCREEN) return;
    const next = data?.find((request) => !shown.has(request.id));
    if (next) showSignInRequest(next.id);
  }, [data, pathname]);
}
