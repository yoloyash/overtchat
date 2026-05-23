import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { auth } from "@/lib/auth/server";
import { getQueryClient } from "@/lib/queryClient";
import { userKeys } from "@/lib/queries/keys";
import type { UserRow } from "@/lib/queries/users";
import { UsersPanel } from "./UsersPanel";

export default async function Page() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/settings/general");

  const qc = getQueryClient();
  await qc.prefetchQuery({
    queryKey: userKeys.list(),
    queryFn: async () => {
      const result = await auth.api.listUsers({
        query: { limit: 100, sortBy: "createdAt", sortDirection: "desc" },
        headers: h,
      });
      return (result.users ?? []) as UserRow[];
    },
  });

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <UsersPanel currentUserId={session.user.id} />
    </HydrationBoundary>
  );
}
