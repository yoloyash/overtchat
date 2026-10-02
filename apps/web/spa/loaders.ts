import type {
  FetchQueryOptions,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";

/**
 * Finds an item in a cached list query, refetching the list once in case the
 * item was created or changed after the list was cached.
 */
export async function findInListQuery<T, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  query: FetchQueryOptions<T[], Error, T[], TQueryKey>,
  match: (item: T) => boolean,
): Promise<T | undefined> {
  const cached = await queryClient.ensureQueryData(query);
  return (
    cached.find(match) ??
    (await queryClient.fetchQuery({ ...query, staleTime: 0 })).find(match)
  );
}
