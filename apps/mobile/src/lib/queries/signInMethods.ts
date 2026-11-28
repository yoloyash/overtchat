import { i18n } from "@overtchat/shared/i18n";
import { useQuery } from "@tanstack/react-query";
import { PASSWORD_ONLY_SIGN_IN, type SignInMethods } from "@overtchat/shared";
import { useServerUrl } from "@/lib/server-url";
import { queryKeys } from "./keys";

/** How the selected server lets people sign in. It is public, so no session. */
export function useSignInMethods() {
  const serverUrl = useServerUrl();
  return useQuery({
    queryKey: queryKeys.signInMethods(serverUrl ?? ""),
    enabled: !!serverUrl,
    queryFn: async (): Promise<SignInMethods> => {
      const response = await fetch(`${serverUrl}/api/sign-in-methods`);
      // Servers from before single sign-on don't have the endpoint.
      if (response.status === 404) return PASSWORD_ONLY_SIGN_IN;
      if (!response.ok) throw new Error(i18n.t("common.mobile.errors.loadSignInOptions"));
      return response.json();
    },
    staleTime: 60_000,
  });
}
