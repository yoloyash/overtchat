import { useQuery } from "@tanstack/react-query";
import { getAuthClient } from "./client";
import { getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";

/** Native image sources and notification scopes need a resolved cookie. */
export function useAuthCookie() {
  const client = getAuthClient();
  const { data } = client.useSession();
  const session = data?.session;
  const { data: cookie } = useQuery({
    queryKey: queryKeys.authCookie(
      getApiBase(),
      session?.id,
      session?.updatedAt?.toString(),
    ),
    queryFn: () => client.getCookie(),
    enabled: Boolean(session),
    // Never retain credentials after the last consumer unmounts. The root
    // QueryClient also resets on server/user changes.
    gcTime: 0,
  });
  return session ? cookie : undefined;
}
