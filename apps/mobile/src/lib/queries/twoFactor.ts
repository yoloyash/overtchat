import { useQuery } from "@tanstack/react-query";
import type { TwoFactorStatus } from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "./keys";

const NOT_REQUIRED: TwoFactorStatus = { enabled: false, required: false };

/** Whether the server requires this user, an administrator, to set up two-factor. */
export function useTwoFactorStatus() {
  return useQuery({
    queryKey: queryKeys.twoFactor(),
    queryFn: async (): Promise<TwoFactorStatus> => {
      const response = await authFetch(`${getApiBase()}/api/two-factor`);
      // Servers from before two-factor don't have the endpoint.
      if (response.status === 404) return NOT_REQUIRED;
      if (!response.ok) throw new Error("Could not load two-factor status.");
      return response.json();
    },
    staleTime: 60_000,
  });
}
