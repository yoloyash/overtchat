import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { listChatsByProject } from "@/lib/db/chats";
import { getProject } from "@/lib/db/projects";
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

  const chats = await listChatsByProject(id, session.user.id);
  return (
    <ProjectPanel
      project={{
        id: project.id,
        name: project.name,
        instructions: project.instructions,
      }}
      chats={chats.map((c) => ({ id: c.id, title: c.title }))}
    />
  );
}
