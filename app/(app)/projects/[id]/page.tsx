import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { auth } from "@/lib/auth/server";
import { getProject } from "@/lib/db/projects";
import { getQueryClient } from "@/lib/queryClient";
import { projectKeys } from "@/lib/queries/keys";
import type { ProjectListItem } from "@/lib/queries/projects";
import { ProjectPanel } from "./ProjectPanel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const project = await getProject(id, session.user.id);
  if (!project) redirect("/");

  const qc = getQueryClient();
  qc.setQueryData<ProjectListItem>(projectKeys.detail(id), {
    id: project.id,
    name: project.name,
    instructions: project.instructions,
    updatedAt: project.updatedAt.getTime(),
  });

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProjectPanel projectId={id} />
    </HydrationBoundary>
  );
}
