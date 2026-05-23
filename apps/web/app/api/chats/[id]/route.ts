import { auth } from "@/lib/auth/server";
import { deleteChat, renameChat } from "@/lib/db/chats";
import { moveChatToProject } from "@/lib/db/projects";

type PatchBody = {
  title?: string;
  projectId?: string | null;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = (await req.json()) as PatchBody;

  if (typeof body.title === "string") {
    await renameChat(id, session.user.id, body.title);
  }
  if (body.projectId !== undefined) {
    const ok = await moveChatToProject(id, session.user.id, body.projectId);
    if (!ok) return new Response("Not found", { status: 404 });
  }
  return new Response(null, { status: 204 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  await deleteChat(id, session.user.id);
  return new Response(null, { status: 204 });
}
