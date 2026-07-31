import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { auth } from "@/lib/auth/server";
import { listAgentConnections } from "@/lib/db/agentConnections";
import { getQueryClient } from "@/lib/queryClient";
import { agentConnectionKeys } from "@/lib/queries/keys";
import { ConnectionsPanel } from "./ConnectionsPanel";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: agentConnectionKeys.list(),
    queryFn: () => listAgentConnections(session.user.id),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ConnectionsPanel isAdmin={session.user.role === "admin"} />
    </HydrationBoundary>
  );
}
