import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { auth } from "@/lib/auth/server";
import {
  getModelConfig,
  listModelConfigs,
  toAdminModelConfig,
} from "@/lib/db/modelConfigs";
import { getQueryClient } from "@/lib/queryClient";
import { modelConfigKeys } from "@/lib/queries/keys";
import { ModelEditor } from "../ModelEditor";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/settings/general");

  const row = await getModelConfig(id);
  if (!row) redirect("/settings/models");

  const qc = getQueryClient();
  await qc.prefetchQuery({
    queryKey: modelConfigKeys.adminList(),
    queryFn: async () => {
      const rows = await listModelConfigs();
      return rows.map(toAdminModelConfig);
    },
  });

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ModelEditor modelId={id} />
    </HydrationBoundary>
  );
}
