import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { auth } from "@/lib/auth/server";
import { listAgentConnections } from "@/lib/db/agentConnections";
import { withAgentRuntimeStatuses } from "@/lib/agents/connector/status";
import { getQueryClient } from "@/lib/queryClient";
import { agentConnectionKeys } from "@/lib/queries/keys";
import { ConnectionsPanel } from "./ConnectionsPanel";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ add?: string | string[] }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/settings/general");
  const { add } = await searchParams;
  const initialAddOpen = (Array.isArray(add) ? add[0] : add) === "1";

  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: agentConnectionKeys.list(),
    queryFn: async () =>
      withAgentRuntimeStatuses(
        await listAgentConnections(session.user.id),
      ),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ConnectionsPanel
        key={initialAddOpen ? "add-agent" : "connections"}
        initialAddOpen={initialAddOpen}
      />
    </HydrationBoundary>
  );
}
