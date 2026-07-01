import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { auth } from "@/lib/auth/server";
import {
  getToolSettings,
  listMcpServers,
  toAdminMcpServer,
} from "@/lib/db/tools";
import { getQueryClient } from "@/lib/queryClient";
import { toolKeys } from "@/lib/queries/keys";
import { ToolsPanel } from "./ToolsPanel";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/settings/general");

  const qc = getQueryClient();
  await Promise.all([
    qc.prefetchQuery({
      queryKey: toolKeys.settings(),
      queryFn: getToolSettings,
    }),
    qc.prefetchQuery({
      queryKey: toolKeys.mcpServers(),
      queryFn: async () => {
        const rows = await listMcpServers();
        return rows.map(toAdminMcpServer);
      },
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ToolsPanel />
    </HydrationBoundary>
  );
}
