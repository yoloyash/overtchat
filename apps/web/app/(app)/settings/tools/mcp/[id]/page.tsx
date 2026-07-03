import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { auth } from "@/lib/auth/server";
import {
  getMcpServer,
  listMcpServers,
  toAdminMcpServer,
} from "@/lib/db/tools";
import { getQueryClient } from "@/lib/queryClient";
import { toolKeys } from "@/lib/queries/keys";
import { McpServerEditor } from "../../McpServerEditor";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/settings/general");

  const row = await getMcpServer(id);
  if (!row) redirect("/settings/tools");
  const server = toAdminMcpServer(row);

  const qc = getQueryClient();
  await qc.prefetchQuery({
    queryKey: toolKeys.mcpServers(),
    queryFn: async () => {
      const rows = await listMcpServers();
      return rows.map(toAdminMcpServer);
    },
  });

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <McpServerEditor server={server} />
    </HydrationBoundary>
  );
}
