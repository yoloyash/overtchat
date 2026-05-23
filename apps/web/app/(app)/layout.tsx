import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { auth } from "@/lib/auth/server";
import { listChats } from "@/lib/db/chats";
import { listProjects } from "@/lib/db/projects";
import { AppShell } from "@/components/AppShell";
import { Sidebar } from "@/components/Sidebar";
import { getQueryClient } from "@/lib/queryClient";
import { chatKeys, projectKeys } from "@/lib/queries/keys";
import type { ChatListItem } from "@/lib/queries/chats";
import type { ProjectListItem } from "@/lib/queries/projects";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const qc = getQueryClient();
  await Promise.all([
    qc.prefetchQuery({
      queryKey: chatKeys.list(),
      queryFn: async (): Promise<ChatListItem[]> => {
        const rows = await listChats(session.user.id);
        return rows.map((c) => ({
          id: c.id,
          title: c.title,
          projectId: c.projectId,
          updatedAt: c.updatedAt.getTime(),
        }));
      },
    }),
    qc.prefetchQuery({
      queryKey: projectKeys.list(),
      queryFn: async (): Promise<ProjectListItem[]> => {
        const rows = await listProjects(session.user.id);
        return rows.map((p) => ({
          id: p.id,
          name: p.name,
          instructions: p.instructions,
          updatedAt: p.updatedAt.getTime(),
        }));
      },
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <AppShell sidebar={<Sidebar />}>{children}</AppShell>
    </HydrationBoundary>
  );
}
