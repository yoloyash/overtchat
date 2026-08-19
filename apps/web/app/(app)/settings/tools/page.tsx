import { headers } from "next/headers";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { auth } from "@/lib/auth/server";
import {
  listAvailableMcpServers,
  listMcpServers,
  toMcpServer,
} from "@/lib/db/mcpServers";
import { getQueryClient } from "@/lib/queryClient";
import { mcpServerKeys } from "@/lib/queries/keys";
import { ToolsForm } from "./ToolsForm";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const isAdmin = session?.user.role === "admin";

  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: mcpServerKeys.availableList(),
      queryFn: () =>
        listAvailableMcpServers(session.user.id, session.user.role),
    }),
    ...(isAdmin
      ? [
          queryClient.prefetchQuery({
            queryKey: mcpServerKeys.adminList(),
            queryFn: async () => (await listMcpServers()).map(toMcpServer),
          }),
        ]
      : []),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ToolsForm isAdmin={isAdmin} />
    </HydrationBoundary>
  );
}
