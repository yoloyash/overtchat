import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { auth } from "@/lib/auth/server";
import { listAgentConnections } from "@/lib/db/agentConnections";
import { withAgentRuntimeStatuses } from "@/lib/agents/runtime/status";
import { getQueryClient } from "@/lib/queryClient";
import { agentConnectionKeys } from "@/lib/queries/keys";
import { ConnectionsPanel } from "./ConnectionsPanel";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/settings/general");

  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: agentConnectionKeys.list(),
    queryFn: async () =>
      withAgentRuntimeStatuses(
        await listAgentConnections(session.user.id),
        session.user.id,
      ),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ConnectionsPanel />
    </HydrationBoundary>
  );
}
