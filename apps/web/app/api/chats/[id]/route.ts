import { auth } from "@/lib/auth/server";
import { deleteChat, renameChat, setChatPinned } from "@/lib/db/chats";
import { z } from "zod";
import { closeChatMcpRuntime } from "@/lib/mcp/manager";
import { moveChatToProject } from "@/lib/db/projects";

const patchSchema = z.object({
  title: z.string().optional(),
  projectId: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const body = parsed.data;

  if (body.pinned !== undefined) {
    const ok = await setChatPinned(id, session.user.id, body.pinned);
    if (!ok) return new Response("Not found", { status: 404 });
  }

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
  await closeChatMcpRuntime({ chatId: id, userId: session.user.id });
  return new Response(null, { status: 204 });
}
